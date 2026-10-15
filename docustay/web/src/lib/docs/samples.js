// The request panel's eight languages for one operation. Plain HTTP examples written from the OpenAPI operation (the SDK pages show the SDK calls); each is complete enough to paste and run with DOCUSTAY_KEY set.
const HOST = "https://app.docustay.app";
const urlOf = (op) => HOST + op.path.replace(/\{(\w+)\}/g, "<$1>");
const q = (s) => JSON.stringify(s);
export function samples(op) {
  const url = urlOf(op), m = op.method, hasBody = op.bodyExample !== null, write = m !== "GET" && m !== "DELETE";
  const json = hasBody ? JSON.stringify(op.bodyExample, null, 2) : null, flat = hasBody ? JSON.stringify(op.bodyExample) : null;
  const idem = m === "POST";
  const curl = [`curl${m === "GET" ? "" : ` -X ${m}`} ${url} \\`, `  -H "Authorization: Bearer $DOCUSTAY_KEY"${idem || hasBody ? " \\" : ""}`];
  if (idem) curl[curl.length - 1] += `\n  -H "Idempotency-Key: $(uuidgen)"${hasBody ? " \\" : ""}`;
  if (hasBody) curl.push(`  -H "Content-Type: application/json" \\`, `  -d '${flat}'`);
  const hdrJs = [`Authorization: \`Bearer \${process.env.DOCUSTAY_KEY}\``, ...(idem ? ["\"Idempotency-Key\": crypto.randomUUID()"] : []), ...(hasBody ? ["\"Content-Type\": \"application/json\""] : [])].map((x) => `    ${x},`).join("\n");
  const js = `const res = await fetch(${q(url)}, {\n  method: ${q(m)},\n  headers: {\n${hdrJs}\n  },${hasBody ? `\n  body: JSON.stringify(${json.replace(/\n/g, "\n  ")}),` : ""}\n});\nconsole.log(res.status, await res.json());`;
  const hdrPy = [`"Authorization": f"Bearer {os.environ['DOCUSTAY_KEY']}"`, ...(idem ? [`"Idempotency-Key": str(uuid.uuid4())`] : [])].map((x) => `    ${x},`).join("\n");
  const py = `import os, uuid, requests\n\nres = requests.${m.toLowerCase()}(\n    ${q(url)},\n    headers={\n${hdrPy.replace(/^ {4}/gm, "        ")}\n    },${hasBody ? `\n    json=${JSON.stringify(op.bodyExample, null, 4).replace(/\n/g, "\n    ").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None")},` : ""}\n)\nprint(res.status_code, res.json())`;
  const go = `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n\t"os"${hasBody ? `\n\t"strings"` : ""}\n)\n\nfunc main() {\n\t${hasBody ? `body := strings.NewReader(${"`"}${flat}${"`"})\n\treq, _ := http.NewRequest(${q(m)}, ${q(url)}, body)\n\treq.Header.Set("Content-Type", "application/json")` : `req, _ := http.NewRequest(${q(m)}, ${q(url)}, nil)`}\n\treq.Header.Set("Authorization", "Bearer "+os.Getenv("DOCUSTAY_KEY"))${idem ? `\n\treq.Header.Set("Idempotency-Key", "<a new unique value>")` : ""}\n\tres, _ := http.DefaultClient.Do(req)\n\tdefer res.Body.Close()\n\tout, _ := io.ReadAll(res.Body)\n\tfmt.Println(res.StatusCode, string(out))\n}`;
  const php = `<?php\n$ch = curl_init(${q(url)});\ncurl_setopt_array($ch, [\n    CURLOPT_CUSTOMREQUEST => ${q(m)},\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer " . getenv("DOCUSTAY_KEY"),${idem ? `\n        "Idempotency-Key: " . bin2hex(random_bytes(16)),` : ""}${hasBody ? `\n        "Content-Type: application/json",` : ""}\n    ],${hasBody ? `\n    CURLOPT_POSTFIELDS => ${q(flat)},` : ""}\n]);\n$out = curl_exec($ch);\necho curl_getinfo($ch, CURLINFO_HTTP_CODE), " ", $out;`;
  const cs = `using System.Net.Http;\n\nvar http = new HttpClient();\nvar req = new HttpRequestMessage(new HttpMethod(${q(m)}), ${q(url)});\nreq.Headers.Add("Authorization", "Bearer " + Environment.GetEnvironmentVariable("DOCUSTAY_KEY"));${idem ? `\nreq.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());` : ""}${hasBody ? `\nreq.Content = new StringContent(${q(flat)}, System.Text.Encoding.UTF8, "application/json");` : ""}\nvar res = await http.SendAsync(req);\nConsole.WriteLine((int)res.StatusCode + " " + await res.Content.ReadAsStringAsync());`;
  void write;
  return [["curl", "curl", "bash", curl.join("\n")], ["js", "JavaScript", "javascript", js], ["py", "Python", "python", py], ["go", "Go", "go", go], ["php", "PHP", "php", php], ["cs", "C#", "csharp", cs]];
}
