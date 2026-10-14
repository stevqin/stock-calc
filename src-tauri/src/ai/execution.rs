use super::types::{AiError, AiResult, Asset, Snapshot};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Policy {
    pub preference: String,
    pub reserve_percent: u32,
    pub t_percent: u32,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            preference: "tFirst".into(),
            reserve_percent: 50,
            t_percent: 25,
        }
    }
}
impl Policy {
    pub fn validate(&self) -> AiResult<()> {
        if !["tFirst", "riskFirst", "averageDown"].contains(&self.preference.as_str())
            || self.reserve_percent > 100
            || self.t_percent == 0
            || self.t_percent > 100
        {
            return Err(fail("executionPolicy", "方案偏好或底仓/单轮比例无效"));
        }
        Ok(())
    }
}
fn fail(path: &str, message: &str) -> AiError {
    AiError::new("invalidAnalysis", &format!("{path}：{message}"))
}
fn d(v: &Value) -> Option<Decimal> {
    v.as_str().and_then(|s| {
        Decimal::from_str(s)
            .or_else(|_| Decimal::from_scientific(s))
            .ok()
    })
}
fn z(v: &Value) -> Decimal {
    d(v).unwrap_or(Decimal::ZERO)
}
fn amount(n: Decimal) -> Decimal {
    n.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}
fn money(n: Decimal) -> String {
    format!("{:.2}", amount(n))
}
fn cost(n: Decimal, q: Decimal) -> Value {
    if q.is_zero() {
        Value::Null
    } else {
        json!(format!(
            "{:.4}",
            (n / q).round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero)
        ))
    }
}
fn content(s: &Snapshot, kind: &str) -> Value {
    s.evidence
        .iter()
        .find(|e| e.kind == kind)
        .and_then(|e| serde_json::from_str(&e.content).ok())
        .unwrap_or(Value::Null)
}
pub fn context(s: &Snapshot) -> Option<Value> {
    s.evidence
        .iter()
        .find(|e| e.kind == "execution")
        .and_then(|e| serde_json::from_str(&e.content).ok())
}
pub fn enabled(s: &Snapshot) -> bool {
    s.rule_versions["executionVersion"] == 1
}
fn fee_valid(f: &Value) -> bool {
    [
        ("commissionWan", Decimal::from(30)),
        ("minimum", Decimal::from(10000)),
        ("stampPercent", Decimal::ONE),
        ("transferPercent", Decimal::ONE),
    ]
    .iter()
    .all(|(k, max)| d(&f[*k]).is_some_and(|v| v >= Decimal::ZERO && v <= *max))
}
fn fees(
    ctx: &Value,
    price: Decimal,
    q: Decimal,
    side: &str,
) -> AiResult<(Decimal, Decimal, Decimal)> {
    let f = &ctx["fees"];
    if !fee_valid(f) {
        return Err(fail("executionPlan", "费率未确认或无法计算"));
    }
    let gross = amount(price * q);
    let commission =
        amount((gross * z(&f["commissionWan"]) / Decimal::from(10000)).max(z(&f["minimum"])));
    let transfer = amount(gross * z(&f["transferPercent"]) / Decimal::from(100));
    let stamp = if side == "sell" {
        amount(gross * z(&f["stampPercent"]) / Decimal::from(100))
    } else {
        Decimal::ZERO
    };
    let fee = commission + transfer + stamp;
    Ok((
        gross,
        fee,
        if side == "sell" {
            gross - fee
        } else {
            gross + fee
        },
    ))
}
fn round_unit(value: Decimal, unit: Decimal, up: bool) -> Decimal {
    let x = value / unit;
    if up {
        x.ceil() * unit
    } else {
        x.floor() * unit
    }
}
pub fn attach(s: &mut Snapshot, policy: Policy) -> AiResult<()> {
    policy.validate()?;
    let p = content(s, "position");
    let cash = content(s, "cash");
    let quote = content(s, "quote");
    let stock = s.security.asset == Asset::Stock;
    let star = stock
        && s.security.market == "sh"
        && (s.security.code.starts_with("688") || s.security.code.starts_with("689"));
    let supported = if stock {
        if s.security.market == "sh" {
            star || ["600", "601", "603", "605"]
                .iter()
                .any(|p| s.security.code.starts_with(p))
        } else {
            s.security.market == "sz"
                && ["000", "001", "002", "003", "300", "301"]
                    .iter()
                    .any(|p| s.security.code.starts_with(p))
        }
    } else {
        ["sh", "sz"].contains(&s.security.market.as_str()) && quote["kind"] == "etf"
    };
    let lot = Decimal::from(100);
    let minimum = Decimal::from(if star { 200 } else { 100 });
    let tick = if stock {
        Decimal::new(1, 2)
    } else {
        Decimal::new(1, 3)
    };
    let dp = if stock { 2 } else { 3 };
    let q = d(&p["quantity"])
        .filter(|v| *v >= Decimal::ZERO && *v <= Decimal::from(100000000))
        .unwrap_or(Decimal::ZERO);
    let next = ["review", "nonTradingDay"].contains(&s.windows["todayMode"].as_str().unwrap_or(""));
    let available = if next && p["settlement"] == "T+1" {
        q
    } else {
        z(&p["available"])
    };
    let reserve = round_unit(
        q * Decimal::from(policy.reserve_percent) / Decimal::from(100),
        lot,
        true,
    )
    .min(q);
    let free = round_unit((q - reserve).max(Decimal::ZERO).min(available), lot, false);
    let single_limit = Decimal::from(if star { 100000 } else { 1000000 });
    let max_t = if free >= minimum {
        round_unit(
            q * Decimal::from(policy.t_percent) / Decimal::from(100),
            lot,
            false,
        )
        .min(free)
        .min(single_limit)
    } else {
        Decimal::ZERO
    };
    let max_t = if max_t >= minimum {
        max_t
    } else {
        Decimal::ZERO
    };
    let mut levels = vec![];
    let mut add = |name: &str, value: &Value, source: Option<&str>| {
        if let Some(price) = d(value).filter(|p| *p > Decimal::ZERO && *p <= Decimal::from(1000000))
        {
            let rounded = (price / tick)
                .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                * tick;
            levels.push(json!({"id":format!("L{}",levels.len()+1),"name":name,"price":format!("{:.*}",dp as usize,rounded),"evidenceId":source}));
        }
    };
    let quote_id = s
        .evidence
        .iter()
        .find(|e| e.kind == "quote")
        .map(|e| e.id.as_str());
    for (key, name) in [
        ("latest", "参考价"),
        ("previousClose", "昨收"),
        ("open", "今日开盘"),
        ("high", "今日高点"),
        ("low", "今日低点"),
    ] {
        add(name, &quote[key], quote_id);
    }
    let daily = content(s, "daily");
    let date = quote["quoteTime"]
        .as_str()
        .unwrap_or("")
        .get(..8)
        .unwrap_or("")
        .to_string();
    let bars = daily["bars"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|r| {
                    r["date"]
                        .as_str()
                        .is_some_and(|day| day.replace('-', "") < date)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let daily_id = s
        .evidence
        .iter()
        .find(|e| e.kind == "daily")
        .map(|e| e.id.as_str());
    if let Some(last) = bars.last() {
        for (key, name) in [("high", "前一交易日高点"), ("low", "前一交易日低点")] {
            add(name, &last[key], daily_id);
        }
    }
    for count in [5usize, 20] {
        let rows = bars.iter().rev().take(count).collect::<Vec<_>>();
        for (key, name, high) in [
            ("high", format!("近{count}日高点"), true),
            ("low", format!("近{count}日低点"), false),
        ] {
            let values = rows.iter().filter_map(|r| d(&r[key])).collect::<Vec<_>>();
            if let Some(price) = if high {
                values.iter().max()
            } else {
                values.iter().min()
            } {
                add(&name, &json!(price.to_string()), daily_id);
            }
        }
    }
    let pos_id = s
        .evidence
        .iter()
        .find(|e| e.kind == "position")
        .map(|e| e.id.as_str());
    add("摊薄成本参考（并非技术支撑）", &p["dilutedCost"], pos_id);
    let mut issues = vec![];
    if !supported {
        issues.push("证券交易单位尚未核验，不给具体交易股数")
    }
    if p.is_null() {
        issues.push("未提供本股持仓与费率，具体股数无法核验")
    }
    if p["feeConfirmed"] != true || !fee_valid(&p["feeProfile"]) {
        issues.push("费率未确认，不能验证费用和回补资金")
    }
    if cash.is_null()
        || cash["initialized"] != true
        || cash["hasWarnings"] == true
        || d(&cash["balance"])
            .is_none_or(|v| v < Decimal::ZERO || v > Decimal::from(1000000000000i64))
    {
        issues.push("本机余额未初始化、异常或不可核验")
    }
    if s.source_states["quoteIsCurrent"] != true {
        issues.push("报价时效不足，不能形成当前价格股数预案")
    }
    if levels.is_empty() {
        issues.push("没有可核验的价位参考")
    }
    if d(&p["quantity"]).is_none_or(|v| v < Decimal::ZERO || v > Decimal::from(100000000))
        || available < Decimal::ZERO
        || available > q
        || d(&p["netInvestment"]).is_none_or(|v| v.abs() > Decimal::from(1000000000000000i64))
    {
        issues.push("持仓或净投入无法核验")
    }
    let mut ctx = json!({"version":1,"cutoffAt":s.cutoff_at,"quoteTime":quote["quoteTime"],"policy":policy,"rules":{"minimumQuantity":minimum.to_string(),"lotStep":"100","tickSize":tick.to_string(),"supported":supported,"note":if star{"科创板最少200股；本预案使用整百股以兼容账本录入"}else{"预案使用整百股，零股处置需单独核对"}},"position":p,"cash":cash,"fees":p["feeProfile"],"feeConfirmed":p["feeConfirmed"],"reserveQuantity":reserve.to_string(),"maxTQuantity":max_t.to_string(),"maxReductionQuantity":free.min(single_limit).to_string(),"singleOrderLimit":single_limit.to_string(),"sellCapacity":available.to_string(),"currentAvailable":p["available"],"quoteIsCurrent":s.source_states["quoteIsCurrent"],"targetSession":if next{format!("下一交易日 {} 预案",s.windows["futureDates"][0].as_str().unwrap_or("待确认"))}else{"今日剩余时段".into()},"nextSession":next,"limitUp":quote["limitUp"],"limitDown":quote["limitDown"],"priceLevels":levels,"qualityIssues":issues});
    if next {
        if let (Some(last), Some(prev), Some(up), Some(down)) = (
            d(&quote["latest"]),
            d(&quote["previousClose"]),
            d(&quote["limitUp"]),
            d(&quote["limitDown"]),
        ) {
            if prev > Decimal::ZERO && up >= prev && down <= prev {
                ctx["limitUp"] = json!(((last * up / prev / tick)
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                    * tick)
                    .to_string());
                ctx["limitDown"] = json!(((last * down / prev / tick)
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                    * tick)
                    .to_string());
                ctx["limitBasis"] =
                    json!("按当前涨跌幅比例与参考收盘估算，下一交易日仍须核对券商范围");
            }
        }
    }
    let lower = d(&ctx["limitDown"]);
    let upper = d(&ctx["limitUp"]);
    for level in ctx["priceLevels"].as_array_mut().unwrap() {
        let p = z(&level["price"]);
        level["planEligible"] =
            json!(!lower.is_some_and(|lo| p < lo) && !upper.is_some_and(|hi| p > hi));
    }
    if let Some(price) = d(&quote["latest"]) {
        if fee_valid(&ctx["fees"]) && ctx["feeConfirmed"] == true {
            let (_, _, need) = fees(&ctx, price, minimum, "buy")?;
            ctx["minimumEntryCash"] = json!(money(need));
            ctx["cashShortfall"] = json!(money((need - z(&cash["balance"])).max(Decimal::ZERO)));
        }
    }
    let mut candidates = vec![];
    if issues.is_empty() && max_t >= minimum {
        if let Some(reference) = d(&quote["latest"]) {
            let eligible = ctx["priceLevels"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|l| l["planEligible"] == true && l["evidenceId"] != json!(pos_id))
                .collect::<Vec<_>>();
            let mut pairs = vec![];
            let mut seen = std::collections::HashSet::new();
            for sell in &eligible {
                for buy in &eligible {
                    let sp = z(&sell["price"]);
                    let bp = z(&buy["price"]);
                    if sp < reference || bp > reference || sp <= bp || !seen.insert((sp, bp)) {
                        continue;
                    }
                    let (_, sf, proceeds) = fees(&ctx, sp, max_t, "sell")?;
                    let (_, bf, required) = fees(&ctx, bp, max_t, "buy")?;
                    if proceeds <= required || z(&cash["balance"]) + proceeds < required {
                        continue;
                    }
                    let profit = proceeds - required;
                    let score = (sp - reference).abs() + (bp - reference).abs();
                    pairs.push((score,json!({"sellId":sell["id"],"buyId":buy["id"],"quantity":max_t.to_string(),"sellPrice":sp.to_string(),"buyPrice":bp.to_string(),"totalFees":money(sf+bf),"netProfit":money(profit),"cashAfterBoth":money(z(&cash["balance"])+profit),"dilutedCostAfterBoth":cost(z(&p["netInvestment"])-profit,q)})));
                }
            }
            pairs.sort_by_key(|(score, _)| *score);
            candidates = pairs.into_iter().take(3).map(|(_, p)| p).collect();
        }
    }
    ctx["verifiedTCandidates"] = json!(candidates);
    let serialized = ctx.to_string();
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    serialized.hash(&mut hash);
    let fingerprint = format!("{:016x}", hash.finish());
    s.evidence.retain(|e| e.kind != "execution");
    s.evidence.push(super::types::Evidence {
        id: uuid::Uuid::new_v4().to_string(),
        security_id: s.security.id.clone(),
        kind: "execution".into(),
        source: "应用计算的交易预案约束（非券商订单）".into(),
        url: None,
        published_at: None,
        time_precision: "exact".into(),
        event_at: Some(s.cutoff_at.clone()),
        collected_at: s.frozen_at.clone(),
        content: serialized,
        content_hash: fingerprint,
        availability: "computed".into(),
    });
    s.rule_versions["executionVersion"] = json!(1);
    Ok(())
}
pub fn shape(s: &Snapshot) -> Value {
    let ctx = context(s).unwrap_or(Value::Null);
    let watches = ctx["priceLevels"][0]["id"]
        .as_str()
        .map(|id| vec![id])
        .unwrap_or_default();
    let waiting = json!({"status":"wait","reason":"填写本分支的适用条件；资料不足需具体说明","invalidation":"填写停止/取消条件","watchLevelIds":watches,"steps":[]});
    let mut plan = json!({"decision":"用一句话说明当前先做什么、什么价位处理多少股，或明确等待哪个条件","preferredScenario":"wait","scenarios":{"tRoundTrip":waiting,"riskReduction":waiting,"entry":waiting}});
    if let Some(c) = ctx["verifiedTCandidates"]
        .as_array()
        .and_then(|v| v.first())
    {
        plan["preferredScenario"] = json!("tRoundTrip");
        plan["scenarios"]["tRoundTrip"]["status"] = json!("conditional");
        plan["scenarios"]["tRoundTrip"]["steps"] = json!([{"side":"sell","lowId":c["sellId"],"highId":c["sellId"],"quantity":c["quantity"],"trigger":"填写卖出价触发后需观察的量价信号","dependency":"none"},{"side":"buy","lowId":c["buyId"],"highId":c["buyId"],"quantity":c["quantity"],"trigger":"填写回落企稳信号，必须等待先卖成交及回款可用","dependency":"sellFilled"}]);
    }
    plan
}
fn level(ctx: &Value, id: &Value, path: &str) -> AiResult<Decimal> {
    ctx["priceLevels"]
        .as_array()
        .and_then(|rows| rows.iter().find(|p| p["id"] == *id))
        .and_then(|v| d(&v["price"]))
        .ok_or_else(|| fail(path, "价位编号不属于本次冻结资料"))
}
fn validate_range(ctx: &Value, step: &Value, path: &str) -> AiResult<(Decimal, Decimal)> {
    let lo = level(ctx, &step["lowId"], &format!("{path}.lowId"))?;
    let hi = level(ctx, &step["highId"], &format!("{path}.highId"))?;
    if lo > hi {
        return Err(fail(path, "价格区间下限高于上限"));
    }
    let tick = z(&ctx["rules"]["tickSize"]);
    if tick <= Decimal::ZERO || lo % tick != Decimal::ZERO || hi % tick != Decimal::ZERO {
        return Err(fail(path, "价位不符合最小报价单位"));
    }
    if d(&ctx["limitDown"]).is_some_and(|p| lo < p) || d(&ctx["limitUp"]).is_some_and(|p| hi > p) {
        return Err(fail(path, "价位超过本次交易日参考涨跌停范围"));
    }
    Ok((lo, hi))
}
fn enrich_case(ctx: &Value, name: &str, input: &Value) -> AiResult<Value> {
    let path = format!("executionPlan.scenarios.{name}");
    let mut case = input.clone();
    for key in ["reason", "invalidation"] {
        super::analysis::field_text(&case, key, 3000, &format!("{path}.{key}"))?;
    }
    if !["conditional", "wait", "insufficient", "notApplicable"]
        .contains(&case["status"].as_str().unwrap_or(""))
    {
        return Err(fail(
            &format!("{path}.status"),
            "只能是conditional/wait/insufficient/notApplicable",
        ));
    }
    let watches = case["watchLevelIds"]
        .as_array()
        .filter(|r| {
            (ctx["priceLevels"].as_array().is_some_and(|p| p.is_empty()) || !r.is_empty())
                && r.len() <= 5
        })
        .cloned()
        .ok_or_else(|| {
            fail(
                &format!("{path}.watchLevelIds"),
                "必须选择1～5个已知价位编号",
            )
        })?;
    let mut watch_prices = vec![];
    for id in &watches {
        watch_prices.push(level(ctx, id, &format!("{path}.watchLevelIds"))?.to_string());
    }
    case["watchPrices"] = json!(watch_prices);
    let steps = case["steps"]
        .as_array()
        .cloned()
        .ok_or_else(|| fail(&format!("{path}.steps"), "必须是交易步骤数组"))?;
    if case["status"] != "conditional" {
        if !steps.is_empty() {
            return Err(fail(
                &format!("{path}.steps"),
                "等待/资料不足分支不得带可执行交易步骤",
            ));
        }
        if name == "entry"
            && ctx["qualityIssues"]
                .as_array()
                .is_some_and(|v| v.is_empty())
            && ctx["feeConfirmed"] == true
            && !watches.is_empty()
        {
            let values = watches
                .iter()
                .map(|id| level(ctx, id, &path))
                .collect::<AiResult<Vec<_>>>()?;
            let min = *values.iter().min().unwrap();
            let max = *values.iter().max().unwrap();
            let qty = z(&ctx["rules"]["minimumQuantity"]);
            let (_, _, need_lo) = fees(ctx, min, qty, "buy")?;
            let (_, _, need_hi) = fees(ctx, max, qty, "buy")?;
            case["entryFunding"] = json!({"quantity":qty.to_string(),"requiredMin":money(need_lo),"requiredMax":money(need_hi),"gapMin":money((need_lo-z(&ctx["cash"]["balance"])).max(Decimal::ZERO)),"gapMax":money((need_hi-z(&ctx["cash"]["balance"])).max(Decimal::ZERO))});
        }
        return Ok(case);
    }
    if ctx["qualityIssues"]
        .as_array()
        .is_none_or(|v| !v.is_empty())
        || ctx["rules"]["supported"] != true
        || ctx["feeConfirmed"] != true
    {
        return Err(fail(
            &path,
            "账户、费率、行情或交易规则未核验，必须等待并清空steps",
        ));
    }
    let expected = if name == "tRoundTrip" { 2 } else { 1 };
    if steps.len() != expected {
        return Err(fail(
            &format!("{path}.steps"),
            &format!("此分支必须有{expected}个步骤"),
        ));
    }
    if name == "tRoundTrip" {
        if let Some(candidates) = ctx["verifiedTCandidates"].as_array() {
            if !candidates.iter().any(|c| {
                steps[0]["lowId"] == c["sellId"]
                    && steps[0]["highId"] == c["sellId"]
                    && steps[1]["lowId"] == c["buyId"]
                    && steps[1]["highId"] == c["buyId"]
                    && steps[0]["quantity"] == c["quantity"]
                    && steps[1]["quantity"] == c["quantity"]
            }) {
                return Err(fail(&path,"做T须完整选择一个verifiedTCandidates组合，不改价位/股数、不扩大价格区间；无候选则等待"));
            }
        }
    }
    let original_q = z(&ctx["position"]["quantity"]);
    let mut q = original_q;
    let mut available = d(&ctx["sellCapacity"]).unwrap_or_else(|| z(&ctx["position"]["available"]));
    let mut cash_lo = z(&ctx["cash"]["balance"]);
    let mut cash_hi = cash_lo;
    let initial_cash = cash_lo;
    let mut net_lo = z(&ctx["position"]["netInvestment"]);
    let mut net_hi = net_lo;
    let mut fee_lo = Decimal::ZERO;
    let mut fee_hi = Decimal::ZERO;
    let mut first_q = None;
    let mut out = vec![];
    for (i, mut step) in steps.into_iter().enumerate() {
        let sp = format!("{path}.steps[{i}]");
        super::analysis::field_text(&step, "trigger", 3000, &format!("{sp}.trigger"))?;
        let expected_side = if name == "entry" || (name == "tRoundTrip" && i == 1) {
            "buy"
        } else {
            "sell"
        };
        if step["side"] != expected_side {
            return Err(fail(
                &format!("{sp}.side"),
                "先卖后买做T、减仓只卖、加仓只买，不能混用",
            ));
        }
        let qty = step["quantity"]
            .as_str()
            .filter(|s| {
                !s.is_empty() && !s.starts_with('0') && s.bytes().all(|c| c.is_ascii_digit())
            })
            .and_then(|_| d(&step["quantity"]))
            .filter(|v| *v > Decimal::ZERO && v.fract().is_zero() && *v <= Decimal::from(100000000))
            .ok_or_else(|| fail(&format!("{sp}.quantity"), "股数必须是正整数字符串"))?;
        let lot = z(&ctx["rules"]["lotStep"]);
        if lot <= Decimal::ZERO
            || qty < z(&ctx["rules"]["minimumQuantity"])
            || qty % lot != Decimal::ZERO
        {
            return Err(fail(
                &format!("{sp}.quantity"),
                "股数不符合本证券整手及最小申报数量",
            ));
        }
        let cap = if name == "tRoundTrip" {
            z(&ctx["maxTQuantity"])
        } else if name == "riskReduction" {
            z(&ctx["maxReductionQuantity"])
        } else {
            round_unit(
                original_q * Decimal::from(25) / Decimal::from(100),
                lot,
                false,
            )
            .max(z(&ctx["rules"]["minimumQuantity"]))
        };
        if qty > cap.min(d(&ctx["singleOrderLimit"]).unwrap_or(Decimal::from(1000000))) {
            return Err(fail(
                &format!("{sp}.quantity"),
                &format!("超过本分支股数上限 {cap}"),
            ));
        }
        let dep = if expected_side == "sell" {
            "none"
        } else if name == "tRoundTrip" {
            "sellFilled"
        } else {
            "cashAvailable"
        };
        if step["dependency"] != dep {
            return Err(fail(
                &format!("{sp}.dependency"),
                "买回必须等待卖出成交并确认券商回款可用；加仓需现有资金确认",
            ));
        }
        if name == "tRoundTrip" {
            if i == 0 {
                first_q = Some(qty)
            } else if first_q != Some(qty) {
                return Err(fail(
                    &format!("{sp}.quantity"),
                    "此做T分支买回股数必须等于先卖股数",
                ));
            }
        }
        let (lo, hi) = validate_range(ctx, &step, &sp)?;
        let (_, fl, cl) = fees(ctx, lo, qty, expected_side)?;
        let (_, fh, ch) = fees(ctx, hi, qty, expected_side)?;
        fee_lo += fl.min(fh);
        fee_hi += fl.max(fh);
        if expected_side == "sell" {
            if qty > available || q - qty < z(&ctx["reserveQuantity"]) {
                return Err(fail(
                    &format!("{sp}.quantity"),
                    "超过可卖数量或侵占保留底仓",
                ));
            }
            q -= qty;
            available -= qty;
            cash_lo += cl;
            cash_hi += ch;
            net_lo -= ch;
            net_hi -= cl;
        } else {
            if ch > cash_lo {
                return Err(fail(
                    &format!("{sp}.quantity"),
                    &format!(
                        "最高买回价含费用需 {} 元，可用资金下限只有 {} 元",
                        money(ch),
                        money(cash_lo)
                    ),
                ));
            }
            q += qty;
            if ctx["position"]["settlement"] == "T+0" {
                available += qty;
            }
            cash_lo -= ch;
            cash_hi -= cl;
            net_lo += cl;
            net_hi += ch;
        }
        step["priceLow"] = json!(lo.to_string());
        step["priceHigh"] = json!(hi.to_string());
        step["feeMin"] = json!(money(fl.min(fh)));
        step["feeMax"] = json!(money(fl.max(fh)));
        step["cashFlowMin"] = json!(money(cl.min(ch)));
        step["cashFlowMax"] = json!(money(cl.max(ch)));
        step["cashAfterMin"] = json!(money(cash_lo));
        step["cashAfterMax"] = json!(money(cash_hi));
        step["remainingQuantity"] = json!(q.to_string());
        step["remainingAvailable"] = json!(available.to_string());
        step["dilutedCostMin"] = cost(net_lo, q);
        step["dilutedCostMax"] = cost(net_hi, q);
        out.push(step);
    }
    let profit_lo = cash_lo - initial_cash;
    let profit_hi = cash_hi - initial_cash;
    if name == "tRoundTrip" && profit_lo <= Decimal::ZERO {
        return Err(fail(
            &path,
            "最不利价格组合无法覆盖往返费用，不能形成做T预案",
        ));
    }
    case["steps"] = json!(out);
    case["effects"] = json!({"cashAfterMin":money(cash_lo),"cashAfterMax":money(cash_hi),"netProfitMin":if name=="tRoundTrip"{json!(money(profit_lo))}else{Value::Null},"netProfitMax":if name=="tRoundTrip"{json!(money(profit_hi))}else{Value::Null},"totalFeeMin":money(fee_lo),"totalFeeMax":money(fee_hi),"remainingQuantity":q.to_string(),"remainingAvailable":available.to_string(),"dilutedCostMin":cost(net_lo,q),"dilutedCostMax":cost(net_hi,q)});
    Ok(case)
}
pub fn validate_and_enrich(body: &mut Value, s: &Snapshot) -> AiResult<()> {
    if !enabled(s) {
        body.as_object_mut().unwrap().remove("executionPlan");
        return Ok(());
    }
    let ctx = context(s).ok_or_else(|| fail("executionPlan", "冻结预案约束缺失"))?;
    let mut plan = body["executionPlan"].clone();
    super::analysis::field_text(&plan, "decision", 2400, "executionPlan.decision")?;
    let preferred = plan["preferredScenario"].as_str().unwrap_or("").to_string();
    if !["tRoundTrip", "riskReduction", "entry", "wait"].contains(&preferred.as_str()) {
        return Err(fail("executionPlan.preferredScenario", "首选分支无效"));
    }
    let scenarios = plan["scenarios"]
        .as_object()
        .filter(|v| v.len() == 3)
        .ok_or_else(|| {
            fail(
                "executionPlan.scenarios",
                "必须且仅包含tRoundTrip/riskReduction/entry三个条件分支",
            )
        })?;
    let mut enriched = serde_json::Map::new();
    for name in ["tRoundTrip", "riskReduction", "entry"] {
        let value = scenarios
            .get(name)
            .ok_or_else(|| fail("executionPlan.scenarios", "缺少固定分支"))?;
        enriched.insert(name.into(), enrich_case(&ctx, name, value)?);
    }
    if preferred != "wait" && enriched[&preferred]["status"] != "conditional" {
        return Err(fail(
            "executionPlan.preferredScenario",
            "首选分支必须有已校验条件步骤，否则选择wait",
        ));
    }
    plan["scenarios"] = json!(enriched);
    plan["context"] = ctx;
    add_headline(&mut plan);
    body["executionPlan"] = plan;
    Ok(())
}
pub fn t_can_be_funded(s: &Snapshot, body: &Value) -> bool {
    enabled(s)
        && context(s).is_some_and(|ctx| {
            body["executionPlan"]["scenarios"]["tRoundTrip"]["status"] == "conditional"
                && enrich_case(
                    &ctx,
                    "tRoundTrip",
                    &body["executionPlan"]["scenarios"]["tRoundTrip"],
                )
                .is_ok()
        })
}
pub fn sell_capacity(s: &Snapshot) -> Option<Decimal> {
    if enabled(s) {
        context(s)
            .and_then(|ctx| d(&ctx["sellCapacity"]).or_else(|| d(&ctx["position"]["available"])))
    } else {
        None
    }
}

pub fn level_ids(s: &Snapshot, eligible: bool) -> Vec<String> {
    context(s)
        .and_then(|ctx| {
            ctx["priceLevels"].as_array().map(|v| {
                v.iter()
                    .filter(|l| !eligible || l["planEligible"] != false)
                    .filter_map(|l| l["id"].as_str().map(str::to_owned))
                    .collect()
            })
        })
        .unwrap_or_default()
}

pub const RULES:&str="本次必须填写executionPlan量化预案。五类operations的conflictsWith数组只允许today/week/conservative/shortTerm/mediumLongTerm，entry/riskReduction/tRoundTrip是量化分支，不得放入conflictsWith；没有五类冲突则空数组。做T必须完整选一个verifiedTCandidates组合：sellId作为卖出lowId与highId，buyId作为买回lowId与highId，两步quantity均取候选quantity；不扩大区间、不改候选股数，没有候选则等待。entry若cashShortfall>0必须wait且steps=[]，不得用将来卖出回款为独立加仓融资。不要额外添加_check字段或任何示例之外的键，参数必须是合法JSON。采用冻结execution证据中的policy排序。保留底仓，tFirst优先评估先卖后买的同股数做T。必须有decision、preferredScenario、scenarios三个字段；scenarios仅含tRoundTrip/riskReduction/entry。每分支包含status、reason、invalidation、watchLevelIds、steps。价位只能从priceLevels选择L编号，不能编造价格；股数为正整数字符串，遵守reserveQuantity/maxTQuantity/maxReductionQuantity及整手。若价格与费用可支持，给出conditional条件预案，即使尚未到价也填写具体步骤，不将未触发等同资料不足。做T两步：sell的dependency=none；buy的dependency=sellFilled，股数相等，低卖价必须高于高买价且覆盖往返费用。先卖回款可以覆盖买回，不因初始余额少就否定做T；买回前必须确认卖出成交和券商可用回款。减仓一条sell，不许侵占底仓；加仓一条buy，dependency=cashAvailable，现款必须覆盖最高买价含费用。步骤必填side/lowId/highId/quantity/trigger/dependency。触发说明到价之外还需行情信号；invalidation写取消与不追价条件。余额异常、未知规则、未确认费率或行情过期必须等待并清空steps。非conditional步骤为空，watchLevelIds提供可观察价位。preferredScenario可为tRoundTrip/riskReduction/entry/wait；选非wait必须有conditional步骤。每个分支独立评估，不同时执行。费用、余额及摊薄成本由应用校验计算，不在工具参数中自行增加effects或context。decision要清楚说明先做什么、什么价位多少股、未成交/未买回如何处理；不能以泛泛观望替代已有依据的预案。量化预案是条件建议，不是已成交订单。五类operations文字与量化预案保持一致，说明未持仓/不能加仓/中长期资料不足等限制。";
pub fn constrain_tool(mut tool: Value, s: &Snapshot) -> Value {
    if !enabled(s) {
        return tool;
    }
    let all = level_ids(s, false);
    let eligible = level_ids(s, true);
    let plan = &mut tool["parameters"]["properties"]["executionPlan"]["properties"];
    plan["preferredScenario"]["enum"] = json!(["tRoundTrip", "riskReduction", "entry", "wait"]);
    for name in ["tRoundTrip", "riskReduction", "entry"] {
        let case = &mut plan["scenarios"]["properties"][name]["properties"];
        case["status"]["enum"] = json!(["conditional", "wait", "insufficient", "notApplicable"]);
        case["watchLevelIds"] = json!({"type":"array","items":{"type":"string","enum":all},"minItems":if all.is_empty(){0}else{1},"maxItems":5});
        case["steps"] = json!({"type":"array","maxItems":2,"items":{"type":"object","additionalProperties":false,"required":["side","lowId","highId","quantity","trigger","dependency"],"properties":{"side":{"type":"string","enum":["sell","buy"]},"lowId":{"type":"string","enum":eligible},"highId":{"type":"string","enum":eligible},"quantity":{"type":"string","pattern":"^[1-9][0-9]*$"},"trigger":{"type":"string","minLength":1,"maxLength":1800},"dependency":{"type":"string","enum":["none","sellFilled","cashAvailable"]}}}});
    }
    tool
}
pub fn summary_shape(mut body: Value, reports: &[super::types::IndependentReport]) -> Value {
    if let Some(r) = reports.iter().find(|r| r.execution_plan.is_some()) {
        body["executionSelection"] = json!({"reportId":r.id,"scenario":r.execution_plan.as_ref().unwrap()["preferredScenario"],"decision":"选择已有完整预案，说明首选动作和失效条件"});
    }
    body
}
pub fn select_summary(
    body: &mut Value,
    reports: &[super::types::IndependentReport],
) -> AiResult<()> {
    if !reports.iter().any(|r| r.execution_plan.is_some()) {
        body.as_object_mut().unwrap().remove("executionPlan");
        return Ok(());
    }
    let selection = &body["executionSelection"];
    super::analysis::field_text(selection, "decision", 2400, "executionSelection.decision")?;
    let id = selection["reportId"].as_str().unwrap_or("");
    let restored = id
        .strip_prefix('R')
        .and_then(|n| n.parse::<usize>().ok())
        .filter(|i| *i > 0 && *i <= reports.len() && id == format!("R{i}"))
        .map(|i| reports[i - 1].id.as_str())
        .unwrap_or(id);
    let r = reports
        .iter()
        .find(|r| r.id == restored && r.execution_plan.is_some())
        .ok_or_else(|| fail("executionSelection.reportId", "必须选择已有有效量化预案"))?;
    let scenario = selection["scenario"].as_str().unwrap_or("");
    let mut plan = r.execution_plan.clone().unwrap();
    if !["tRoundTrip", "riskReduction", "entry", "wait"].contains(&scenario)
        || (scenario != "wait" && plan["scenarios"][scenario]["status"] != "conditional")
    {
        return Err(fail(
            "executionSelection.scenario",
            "只能选择已有可用分支或wait",
        ));
    }
    plan["preferredScenario"] = json!(scenario);
    plan["decision"] = selection["decision"].clone();
    plan["sourceReportId"] = json!(r.id);
    add_headline(&mut plan);
    body["executionPlan"] = plan;
    body["executionSelection"]["reportId"] = json!(r.id);
    Ok(())
}

fn add_headline(plan: &mut Value) {
    let name = plan["preferredScenario"].as_str().unwrap_or("wait");
    let ctx = &plan["context"];
    let case = &plan["scenarios"][name];
    let phrase = |step: &Value| {
        let range = if step["priceLow"] == step["priceHigh"] {
            step["priceLow"].as_str().unwrap_or("—").to_string()
        } else {
            format!(
                "{}～{}",
                step["priceLow"].as_str().unwrap_or("—"),
                step["priceHigh"].as_str().unwrap_or("—")
            )
        };
        format!(
            "{}元{}{}股",
            range,
            if step["side"] == "sell" {
                "卖出"
            } else {
                "买入"
            },
            step["quantity"].as_str().unwrap_or("—")
        )
    };
    let text = if name == "tRoundTrip" {
        format!("保留{}股底仓；条件满足时先{}，卖出成交且回款可用后，再按{}的条件评估买回。未触发则等待。",ctx["reserveQuantity"].as_str().unwrap_or("—"),phrase(&case["steps"][0]),phrase(&case["steps"][1]))
    } else if name == "riskReduction" {
        format!(
            "保留至少{}股底仓；满足减仓条件后按{}，不同时执行做T或加仓分支。",
            ctx["reserveQuantity"].as_str().unwrap_or("—"),
            phrase(&case["steps"][0])
        )
    } else if name == "entry" {
        format!(
            "只在行情条件满足、券商可用资金确认后，按{}；未确认则等待。",
            phrase(&case["steps"][0])
        )
    } else {
        "当前先等待，不执行买卖；按下方观察价位与条件重新评估。".to_string()
    };
    plan["headline"] = json!(text);
}
