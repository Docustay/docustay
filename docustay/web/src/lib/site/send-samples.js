// The Go, PHP and C# send samples: the home page's code windows and the Sign a PDF pages show the same programs, and scripts/snippets-run.mjs runs them against a checking server (Go, PHP) or with dotnet (C#).
export const GO = `package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	base := os.Getenv("DOCUSTAY_URL")
	if base == "" {
		base = "https://app.docustay.app"
	}
	body := []byte(\`{"templateId":"\` + os.Getenv("DOCUSTAY_TEMPLATE_ID") + \`","parties":[{"seat":"signer_1","name":"Pat Example","email":"pat@example.com"}]}\`)
	req, _ := http.NewRequest("POST", base+"/api/v1/documents/send", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+os.Getenv("DOCUSTAY_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("send-%d", os.Getpid()))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		panic(fmt.Sprintf("send failed (%d): %s", res.StatusCode, out))
	}
	fmt.Println(string(out))
}`;
export const PHP = `<?php
$base = getenv("DOCUSTAY_URL") ?: "https://app.docustay.app";
$body = json_encode([
  "templateId" => getenv("DOCUSTAY_TEMPLATE_ID"),
  "parties" => [["seat" => "signer_1", "name" => "Pat Example", "email" => "pat@example.com"]],
]);
$ch = curl_init($base . "/api/v1/documents/send");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $body,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . getenv("DOCUSTAY_API_KEY"),
    "Content-Type: application/json",
    "Idempotency-Key: " . bin2hex(random_bytes(16)),
  ],
]);
$out = curl_exec($ch);
if (curl_getinfo($ch, CURLINFO_HTTP_CODE) >= 300) { fwrite(STDERR, "send failed: $out\\n"); exit(1); }
echo $out, "\\n";`;
export const CSHARP = `using System;
using System.Net.Http;
using System.Text;

var baseUrl = Environment.GetEnvironmentVariable("DOCUSTAY_URL") ?? "https://app.docustay.app";
var body = "{\\"templateId\\":\\"" + Environment.GetEnvironmentVariable("DOCUSTAY_TEMPLATE_ID") + "\\","
  + "\\"parties\\":[{\\"seat\\":\\"signer_1\\",\\"name\\":\\"Pat Example\\",\\"email\\":\\"pat@example.com\\"}]}";
using var http = new HttpClient();
using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/v1/documents/send") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
request.Headers.Add("Authorization", "Bearer " + Environment.GetEnvironmentVariable("DOCUSTAY_API_KEY"));
request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
var response = await http.SendAsync(request);
var text = await response.Content.ReadAsStringAsync();
if (!response.IsSuccessStatusCode) throw new Exception("send failed (" + (int)response.StatusCode + "): " + text);
Console.WriteLine(text);`;
