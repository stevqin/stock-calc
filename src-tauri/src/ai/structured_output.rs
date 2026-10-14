use serde_json::{json, Value};
pub fn tool(
    name: &str,
    example: &Value,
    evidence_ids: &[String],
    report_ids: &[String],
    claim_ids: &[String],
) -> Value {
    fn infer(
        v: &Value,
        key: &str,
        path: &str,
        evidence: &[String],
        reports: &[String],
        claims: &[String],
    ) -> Value {
        match v {
            Value::Object(o) => {
                let properties = o
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            infer(v, k, &format!("{path}.{k}"), evidence, reports, claims),
                        )
                    })
                    .collect::<serde_json::Map<_, _>>();
                json!({"type":"object","properties":properties,"required":o.keys().collect::<Vec<_>>(),"additionalProperties":false})
            }
            Value::Array(a) => {
                let mut schema = json!({"type":"array","items":a.first().map(|v|infer(v,"",&format!("{path}[]"),evidence,reports,claims)).unwrap_or(json!({"type":"string"}))});
                match key {
                    "evidenceIds" => {
                        schema["items"] = json!({"type":"string","enum":evidence});
                        schema["minItems"] = json!(1);
                        schema["maxItems"] = json!(30);
                    }
                    "supports" => {
                        schema["minItems"] = json!(1);
                        schema["maxItems"] = json!(reports.len().max(1));
                    }
                    "conflictsWith" => {
                        schema["items"] =
                            json!({"type":"string","enum":super::report_v2::OPERATIONS});
                        schema["maxItems"] = json!(4);
                    }
                    "windows" => {
                        schema["minItems"] = json!(2);
                        schema["maxItems"] = json!(2);
                    }
                    "claims" => {
                        schema["maxItems"] = json!(15);
                    }
                    "keyClaims" => {
                        let fixed = a.iter().all(|c| c.get("operationType").is_some());
                        schema["minItems"] = json!(if fixed { 5 } else { 1 });
                        schema["maxItems"] = json!(if fixed { 5 } else { 20 });
                    }
                    _ => {}
                }
                schema
            }
            Value::String(_) => {
                let values = match key {
                    "direction" => Some(json!(["bullish", "bearish", "sideways", "uncertain"])),
                    "confidence" => Some(json!(["low", "medium", "high"])),
                    "status" => Some(json!([
                        "actionable",
                        "conditional",
                        "wait",
                        "insufficient",
                        "notApplicable"
                    ])),
                    "action" => Some(json!([
                        "hold",
                        "wait",
                        "reduce",
                        "considerBuy",
                        "considerT",
                        "review"
                    ])),
                    "scenario" => Some(json!(["tRoundTrip", "riskReduction", "entry", "wait"])),
                    "operationType" => Some(json!(super::report_v2::OPERATIONS)),
                    "strategy" => Some(json!(["conservative", "intraday", "swing"])),
                    "horizon" if path.contains(".windows[]") => Some(json!(["today", "future"])),
                    "reportId" if !reports.is_empty() => Some(json!(reports)),
                    "claimId" if !claims.is_empty() => Some(json!(claims)),
                    _ => None,
                };
                let mut schema =
                    json!({"type":"string","minLength":1,"maxLength":if key=="id"{80}else{1800}});
                if let Some(values) = values {
                    schema["enum"] = values;
                }
                schema
            }
            Value::Number(_) => json!({"type":"integer","enum":[v]}),
            _ => json!({}),
        }
    }
    json!({"name":name,"description":"提交一次完整股票分析报告，必须包含所有必填字段和模块。将所有判断和引用放入参数，不另行输出报告。","parameters":infer(example,"","",evidence_ids,report_ids,claim_ids)})
}
