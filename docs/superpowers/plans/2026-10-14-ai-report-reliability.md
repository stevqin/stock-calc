# AI report reliability repair

User authorized implementation, tests, packaging and relaunch. No real model calls.

- [ ] Fixed operations object with all five required keys; MiMo documented json_object mode, strict local validation and legacy compatibility.
- [ ] Send evidence once, omit series/indicators copies, losslessly table-encode market data; keep all position/trade/cash information.
- [ ] Exactly one compact repair, disabled extra thinking, original output preserved.
- [ ] TCP connect 15s, response headers 60s, report body 300s; separate failure codes and no automatic resend after accepted headers.
- [ ] Save finish_reason and response completion; explicitly report token truncation.
- [ ] Local fake HTTP and fixture tests, full suites, build, format, independent review.
- [ ] Package 0.9.1, check active tasks, relaunch and check stored data integrity.

Official reference: https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/structured-output
MiMo JSON mode guarantees JSON syntax, not required fields; local checks remain mandatory.

Completed implementation and local verification: 509 frontend, 93 Rust tests; no live model calls. Saved snapshot input reduced 63.2%, financial content preserved. Packaging version 0.9.1.
