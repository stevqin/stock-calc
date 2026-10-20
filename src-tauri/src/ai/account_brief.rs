use super::types::{Asset, Snapshot};
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{json, Value};
use std::str::FromStr;

pub const READING_GUIDE: &str = "数据阅读说明：所有金额均为人民币元，股票数量为股、ETF数量为份；价格为元/股或元/份。数字字符串用于保留精度，null/字段缺失表示未知而不是0。position.quantity是当前持有数量，available是此刻按记录可卖数量；cost/averageCost是剩余持仓FIFO总成本/均价，netInvestment是本轮买入与期初投入减去卖出净回款，dilutedCost是netInvestment除以当前数量（本轮账面回本价，不是技术支撑，也未扣未来卖出费）。本轮以日终清仓分界，同日先清后买仍属同一轮。position.trades逐笔保留本轮记录；buy/sell/opening分别是买入/卖出/期初持仓，期初不是当日新买。若记录与持仓数量不一致须提示核对，不编造缺失成交。fees.cash对买入是含费支出、对卖出是扣费到账；fees.total是这笔费用，缺费用不得按0处理，feeSource区分实录与估算，feeConfirmed仅是费率配置确认，不是券商实盘核对。feeProfile.commissionWan是万分比，stampPercent/transferPercent是百分比，minimum是最低佣金元；按给定配置，不使用固定费率。cash.balance是按已录入账户流水算出的尚可用于买入的现金，是全账户共享额度，不是本股专属预算、总资产或持仓市值；未经券商核对，未反映未录入流水或券商冻结资金，还需预留买入费用；initialized=false、hasWarnings=true或负余额时资金待核实，不据此给出可执行买入数量。accountSummary是上述原始记录的算术解释，不是交易指令。行情columns/rows为无损表格，按列名顺序解读；日线date为交易日期，分时session.date加time(HHMM)是北京时间，ISO时间按标注时区解读。volume/amount沿用数据源原值，未标明单位或累计/增量口径时不得擅自换算或把累计量当每分钟成交量。sourceStates说明数据时效和缺失，旧报价只能作对应时点估值。新闻fullText是实际获取的网页文字正文，图片、PDF附件及交互图表未解析，不据未提供附件推断数字；没有fullText的标题、检索摘要不构成事件事实依据，禁止冒充已阅读原文。正文可能含后续更新，不是交易时点的历史版本；公告titleOnly仅有标题链接，不能据标题编造正文或确定事件影响。";

fn number(v: &Value) -> Option<Decimal> {
    let text = v.as_str()?;
    Decimal::from_str(text)
        .or_else(|_| Decimal::from_scientific(text))
        .ok()
}
fn field(v: &Value, name: &str) -> Option<Decimal> {
    number(&v[name])
}
fn money(v: Decimal) -> String {
    format!(
        "{:.2}",
        v.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
    )
}
fn precise(v: Decimal) -> String {
    format!(
        "{:.4}",
        v.round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero)
    )
}
fn display_time(raw: &str) -> String {
    let zone = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(raw) {
        return date
            .with_timezone(&zone)
            .format("%Y-%m-%d %H:%M:%S（北京时间）")
            .to_string();
    }
    chrono::NaiveDateTime::parse_from_str(raw, "%Y%m%d%H%M%S")
        .map(|date| date.format("%Y-%m-%d %H:%M:%S（北京时间）").to_string())
        .unwrap_or_else(|_| "时间未知".into())
}
fn get(s: &Snapshot, kind: &str) -> Value {
    s.evidence
        .iter()
        .find(|e| e.kind == kind)
        .and_then(|e| serde_json::from_str(&e.content).ok())
        .unwrap_or(Value::Null)
}
fn sum(trades: &[Value], kind: &str) -> Option<Decimal> {
    trades
        .iter()
        .filter(|t| t["kind"] == kind)
        .try_fold(Decimal::ZERO, |a, t| a.checked_add(field(t, "quantity")?))
}
/// Explain frozen inputs using decimal arithmetic. Missing inputs stay unknown; raw records are never changed.
pub fn build(s: &Snapshot) -> Value {
    let p = get(s, "position");
    let c = get(s, "cash");
    let unit = if s.security.asset == Asset::Etf {
        "份"
    } else {
        "股"
    };
    let q = field(&p, "quantity").filter(|q| *q > Decimal::ZERO);
    let available =
        field(&p, "available").filter(|a| *a >= Decimal::ZERO && q.is_some_and(|q| *a <= q));
    let cost = field(&p, "cost").filter(|v| *v >= Decimal::ZERO);
    let net = field(&p, "netInvestment");
    let price = s
        .reference_price
        .as_ref()
        .and_then(|p| number(&json!(p)))
        .filter(|v| *v > Decimal::ZERO);
    let market = price.zip(q).and_then(|(p, q)| p.checked_mul(q));
    let floating = market.zip(cost).and_then(|(v, c)| v.checked_sub(c));
    let round = market.zip(net).and_then(|(v, c)| v.checked_sub(c));
    let realized = cost.zip(net).and_then(|(c, n)| c.checked_sub(n));
    let pct = floating
        .zip(cost)
        .filter(|(_, c)| *c > Decimal::ZERO)
        .and_then(|(v, c)| v.checked_div(c)?.checked_mul(Decimal::from(100)));
    let recovery = net
        .filter(|n| *n > Decimal::ZERO)
        .zip(market)
        .filter(|(_, m)| *m > Decimal::ZERO)
        .and_then(|(n, m)| {
            n.checked_sub(m)?
                .max(Decimal::ZERO)
                .checked_div(m)?
                .checked_mul(Decimal::from(100))
        });
    let break_even = net
        .filter(|n| *n > Decimal::ZERO)
        .zip(q)
        .and_then(|(n, q)| n.checked_div(q));
    let balance = field(&c, "balance");
    let ready = balance.is_some_and(|v| v >= Decimal::ZERO)
        && c["initialized"] == true
        && c["hasWarnings"] == false;
    let trades = p["trades"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let paid = trades
        .iter()
        .filter(|t| t["kind"] == "buy" || t["kind"] == "sell")
        .collect::<Vec<_>>();
    let fees = if trades.is_empty() {
        None
    } else {
        paid.iter().try_fold(Decimal::ZERO, |a, t| {
            a.checked_add(field(&t["fees"], "total").filter(|v| *v >= Decimal::ZERO)?)
        })
    };
    let fees_complete = fees.is_some();
    let state = match (floating, round) {
        (Some(f), Some(r)) if f < Decimal::ZERO && r > Decimal::ZERO => {
            "剩余持仓浮亏，但本轮整体盈利"
        }
        (Some(f), Some(r)) if f > Decimal::ZERO && r < Decimal::ZERO => {
            "剩余持仓浮盈，但本轮整体仍亏损"
        }
        (_, Some(r)) if r < Decimal::ZERO => "本轮整体亏损",
        (_, Some(r)) if r > Decimal::ZERO => "本轮整体盈利",
        (_, Some(_)) => "本轮账面盈亏平衡",
        _ if p.is_null() => "未提供持仓，不能判断是否空仓、被套或盈利",
        _ => "资料不足，盈亏待确定",
    };
    let mut facts = Vec::new();
    if let Some(q) = q {
        facts.push(format!(
            "截至{}，当前持有{}{}；按记录可卖{}{}。",
            display_time(&s.cutoff_at),
            q.normalize(),
            unit,
            available
                .map(|v| v.normalize().to_string())
                .unwrap_or_else(|| "未知".into()),
            unit
        ));
    } else {
        facts.push("未提供持仓，不能假设用户空仓，也不能判断被套或盈利。".into());
    }
    facts.push(match balance {Some(b)=>format!("可用于买入的现金（账户记录值）为{}元，{}；这是全账户共享现金，不等于总资产或持仓市值，须预留费用并核对券商冻结资金。",money(b),if ready{"可作预算参考，未与券商核对"}else{"资金待核实，不能据此确定买入股数"}),None=>"未提供可用于买入的现金，不能假设资金充足或可通过融资补足。".into()});
    if let Some(price) = price {
        facts.push(format!(
            "以下盈亏按采集参考价{}元估值，报价时间{}；{}。",
            price.normalize(),
            display_time(s.source_states["quoteTime"].as_str().unwrap_or("")),
            if s.source_states["quoteIsCurrent"] == true {
                "仍须核对实际成交价"
            } else {
                "报价时效不足，不表示当前实时盈亏"
            }
        ));
    }
    if let Some(v) = floating {
        facts.push(format!(
            "剩余持仓浮动盈亏{}元（参考市值减FIFO剩余成本），不是本轮合计盈亏。",
            money(v)
        ));
    }
    if let Some(v) = round {
        facts.push(format!(
            "本轮合计盈亏{}元（参考市值减本轮净投入）；{}；计入已录入费用，未扣未来卖出费用。",
            money(v),
            state
        ));
    }
    if let Some(v) = break_even {
        facts.push(format!(
            "本轮账面回本价{}元/{}，不是支撑位；未计未来卖出费。",
            precise(v),
            unit
        ));
    } else if net.is_some_and(|n| n <= Decimal::ZERO) {
        facts.push(
            "本轮净投入已非正值，不再给负数回本目标价；这不代表当前持仓没有价格风险。".into(),
        );
    }
    if !trades.is_empty() {
        facts.push(format!(
            "本轮自{}开始，保留{}笔原始记录；{}。",
            display_time(p["roundStart"].as_str().unwrap_or("")),
            trades.len(),
            fees.map(|v| format!("已录入交易费用合计{}元", money(v)))
                .unwrap_or_else(|| "部分费用缺失，不能把费用当0，也不能确认做T净收益".into())
        ));
    }
    json!({"basedOnEvidenceIds":s.evidence.iter().filter(|e|["position","cash","quote"].contains(&e.kind.as_str())).map(|e|e.id.clone()).collect::<Vec<_>>(),"currency":"人民币元","quantityUnit":unit,"asOf":s.cutoff_at,"facts":facts,"cash":{"label":"可用于买入的现金（按已录入账户记录）","balance":balance.map(money),"budgetAvailable":ready,"brokerVerified":false},"position":{"quantity":q.map(|v|v.normalize().to_string()),"available":available.map(|v|v.normalize().to_string()),"fifoRemainingCost":cost.map(money),"roundNetInvestment":net.map(money)},"profitAndLoss":{"state":state,"referencePrice":s.reference_price,"quoteTime":s.source_states["quoteTime"],"quoteIsCurrent":s.source_states["quoteIsCurrent"],"fifoFloating":floating.map(money),"fifoFloatingPct":pct.map(money),"roundTotal":round.map(money),"roundRealized":realized.map(money),"roundBreakEvenPrice":break_even.map(precise),"recoveryToRoundBreakEvenPct":recovery.map(money),"recoveryMeaning":"从参考价上涨多少百分比才达到本轮账面回本价；不是亏损百分比，不含未来卖出费用"},"round":{"start":p["roundStart"],"tradeCount":trades.len(),"boughtQuantity":if trades.is_empty(){None}else{sum(trades,"buy").map(|v|v.normalize().to_string())},"soldQuantity":if trades.is_empty(){None}else{sum(trades,"sell").map(|v|v.normalize().to_string())},"knownFees":fees.map(money),"feesComplete":fees_complete},"reviewBoundary":"复盘必须指出原始成交ID、时间、买卖方向、价格和数量，区分可核对事实与可能的决策问题。只能用当时已知的记录、计划和新闻评估，后来涨跌只作事后表现；未提供当时计划、行情或止损条件时，不能断言追涨杀跌、违反纪律或某笔必然失误。不得因为当前亏损就判定交易错误；证据不足明确无法判断。"})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::Snapshot;
    use serde_json::{json, Value};
    fn snapshot(price: Value, cost: &str, net: &str) -> Snapshot {
        let ev = |kind: &str, content: Value| json!({"id":kind,"securityId":"sh600519","kind":kind,"source":"测试","url":null,"publishedAt":null,"timePrecision":"exact","eventAt":null,"collectedAt":"2026-10-19T06:00:00Z","content":content.to_string(),"contentHash":"test","availability":"userProvided"});
        serde_json::from_value(json!({"id":"snapshot","security":{"id":"sh600519","market":"sh","code":"600519","name":"测试股份","asset":"stock"},"cutoffAt":"2026-10-19T06:00:00Z","frozenAt":"2026-10-19T06:00:01Z","referencePrice":price,"windows":{},"series":{},"indicators":{},"sourceStates":{"quoteIsCurrent":true,"quoteTime":"20261019140000"},"ruleVersions":{},"evidence":[ev("cash",json!({"balance":"1000.00","initialized":true,"hasWarnings":false})),ev("position",json!({"quantity":"100","available":"80","cost":cost,"netInvestment":net,"roundStart":"2026-10-12T02:00:00Z","trades":[{"id":"b","kind":"buy","quantity":"100","price":"10","time":"2026-10-12T02:00:00Z","fees":{"total":"5.00"}},{"id":"s","kind":"sell","quantity":"20","price":"11","time":"2026-10-13T02:00:00Z","fees":{"total":"5.11"}}]}))]})).unwrap()
    }
    #[test]
    fn distinguishes_remaining_floating_loss_from_profitable_round() {
        let s = snapshot(json!("10"), "1100", "900");
        let before = s.clone();
        let b = build(&s);
        assert_eq!(b["profitAndLoss"]["fifoFloating"], "-100.00");
        assert_eq!(b["profitAndLoss"]["roundTotal"], "100.00");
        assert_eq!(b["profitAndLoss"]["roundRealized"], "200.00");
        assert!(b["profitAndLoss"]["state"]
            .as_str()
            .unwrap()
            .contains("剩余持仓浮亏，但本轮整体盈利"));
        assert_eq!(b["round"]["tradeCount"], 2);
        assert_eq!(b["round"]["knownFees"], "10.11");
        assert_eq!(b["cash"]["budgetAvailable"], true);
        assert_eq!(s, before);
    }
    #[test]
    fn recovery_rise_uses_current_value_not_cost_as_denominator() {
        let b = build(&snapshot(json!("8"), "1000", "1000"));
        assert_eq!(b["profitAndLoss"]["roundTotal"], "-200.00");
        assert_eq!(b["profitAndLoss"]["fifoFloatingPct"], "-20.00");
        assert_eq!(b["profitAndLoss"]["recoveryToRoundBreakEvenPct"], "25.00");
    }
    #[test]
    fn absent_position_or_quote_never_becomes_zero_profit() {
        let mut s = snapshot(Value::Null, "1000", "1000");
        let b = build(&s);
        assert!(b["profitAndLoss"]["roundTotal"].is_null());
        s.evidence.retain(|e| e.kind != "position");
        let b = build(&s);
        assert!(b["position"]["quantity"].is_null());
        assert!(b["profitAndLoss"]["roundTotal"].is_null());
        assert!(b.to_string().contains("未提供持仓"));
    }
    #[test]
    fn missing_fees_and_questionable_cash_are_not_treated_as_confirmed() {
        let mut s = snapshot(json!("10"), "1000", "1000");
        for e in &mut s.evidence {
            let mut v: Value = serde_json::from_str(&e.content).unwrap();
            if e.kind == "cash" {
                v["hasWarnings"] = json!(true);
            }
            if e.kind == "position" {
                v["trades"][0]["fees"] = Value::Null;
            }
            e.content = v.to_string();
        }
        let b = build(&s);
        assert_eq!(b["cash"]["budgetAvailable"], false);
        assert_eq!(b["round"]["feesComplete"], false);
        assert!(b["round"]["knownFees"].is_null());
        assert_eq!(b["cash"]["balance"], "1000.00");
    }
    #[test]
    fn recovered_capital_and_decimal_overflow_do_not_crash_or_fake_a_price() {
        let b = build(&snapshot(json!("10"), "1000", "-100"));
        assert_eq!(b["profitAndLoss"]["roundTotal"], "1100.00");
        assert!(b["profitAndLoss"]["roundBreakEvenPrice"].is_null());
        let b = build(&snapshot(
            json!("9999999999999999999999999999"),
            "1000",
            "1000",
        ));
        assert!(b["profitAndLoss"]["roundTotal"].is_null());
    }
}
