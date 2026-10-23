// pass 4 (13 Oct 2026): the longer notes under each "Sign a PDF with <language>" page. Written from the client sources (sdk/js/src/index.js, sdk/python/docustay/client.py), the errors-and-limits doc and the send snippets themselves, which scripts/snippets-run.mjs and signpdf-proof.mjs run. Each page's text is its own: what the code does line by line in that language, what an error looks like there, and how a retry is kept safe.
const ERR = "kind, a plain message, a requestId and a retryable flag";
const SDK = {
  javascript: {
    walk: [
      ["Import and make a client", "new Docustay(key, options) takes the API key and, optionally, a baseUrl, maxRetries and timeoutMs. The example passes baseUrl only when DOCUSTAY_URL is set, so the same file runs against the hosted service or your own install. {{F-SDK}}"],
      ["Name the template and the seat", "templateId is the template's id. In parties, seat names the place on the template, here signer_1, and name and email say who sits there. A template with two signers needs two parties. {{F-API}}"],
      ["Call sendDocument", "One call posts to /api/v1/documents/send. The client adds an Idempotency-Key for you and reuses it on every retry of that call. {{F-API}}"],
      ["Read the answer", "The answer is the document's id and its state, which is sent for a normal send. The example prints both. {{F-SEND}}"],
    ],
    err: ["DocustayError", "A failed call throws a DocustayError with the status, a kind, the requestId, a retryable flag and, for a rate limit, retryAfterSeconds. Log the requestId: it is what makes a support question quick to answer."],
    retry: ["Two retries, a 30-second timeout", "By default the client retries twice, on a network failure, a 429 or a 5xx, and gives each try 30 seconds. On a 429 it waits the Retry-After you were sent, up to 30 seconds. Change both with maxRetries and timeoutMs."],
    install: ["Node 18 or newer", "The package has no dependencies and uses fetch and Web Crypto, so it also runs in Deno, Bun and a browser. Until it is published you install it from a clone of the repository."],
  },
  typescript: {
    walk: [
      ["Import the types with the client", "The package exports Docustay and the SendRequest type together, so one import line gives you the client and the shape of what you send. {{F-SDK}}"],
      ["Build the request as a typed value", "request is declared as a SendRequest, so a misspelt field or a missing templateId fails in your editor before the program runs. The non-null assertions on the environment variables are yours to replace with a real check. {{F-API}}"],
      ["Send it", "sendDocument(request) posts to /api/v1/documents/send with an Idempotency-Key it makes and reuses on every retry. {{F-API}}"],
      ["The answer is typed too", "doc.id and doc.state are known to the compiler, so reading a field that does not exist is an error and not a runtime surprise. {{F-SEND}}"],
    ],
    err: ["DocustayError, narrowed", "A failed call throws a DocustayError. Catch it and read status, kind, requestId and retryable; the kind is one of invalid, unauthenticated, forbidden, not_found, conflict, rate_limited, dependency or timeout."],
    retry: ["Retries you can tune", "The client retries twice by default on a network failure, a 429 or a 5xx, and waits the Retry-After of a 429 up to 30 seconds. Pass maxRetries or timeoutMs in the options to change them."],
    install: ["The types ship inside", "There is no separate types package. The same install gives you the client and its declarations, and the program runs as it stands with a TypeScript runner."],
  },
  python: {
    walk: [
      ["Import and read the key", "Docustay(api_key) takes the key from the environment, with an optional base_url, max_retries and timeout. The example sets base_url only when DOCUSTAY_URL is present. {{F-SDK}}"],
      ["Call send_document", "send_document takes the template id and a list of parties. Each party names a seat, such as signer_1, and who sits there. {{F-API}}"],
      ["One idempotency key per call", "Every POST gets an idempotency key made for it, reused on each retry of that call, so a retried send never emails twice. {{F-API}}"],
      ["Read the dictionary", "Calls are synchronous and return plain dictionaries, so there is no model class to learn. doc[\"id\"] and doc[\"state\"] are what the example prints, and the same dictionary holds the other fields of the answer. {{F-SEND}}"],
    ],
    err: ["DocustayError", "A failed call raises DocustayError with the status, a kind, the requestId, a retryable flag and, for a rate limit, retry_after_seconds. Catch it where you can act on it and log the requestId."],
    retry: ["Two retries, 30 seconds each", "max_retries defaults to 2 and timeout to 30 seconds. A 429 or a 5xx is retried, waiting the Retry-After you were sent, up to 30 seconds, and the same idempotency key is used each time."],
    install: ["Python 3.9 or newer", "The package has no dependencies and uses the standard library. Until it is published, install it from the sdk folder of a clone of the repository."],
  },
  go: {
    walk: [
      ["The standard library only", "The example imports bytes, fmt, io, net/http and os, so there is nothing to download and no module file to keep. Save it as send.go and run it with go run. {{F-API}}"],
      ["Build the POST", "http.NewRequest points at /api/v1/documents/send with the JSON body, and Header.Set adds the bearer key, the JSON content type and the Idempotency-Key. {{F-API}}"],
      ["Make the key a real random value", "The example makes the key from the process id to stay short. In your own program make it from a random value and keep it if you retry, because a new key would mean a second document. {{F-API}}"],
      ["Check the status before you print", "A status of 300 or more stops with the status and the body; otherwise the program prints the answer, which holds the document's id and its state. {{F-SEND}}"],
    ],
    err: ["Read the error object yourself", "With plain HTTP there is no exception type: on a failure the body is a JSON object with a kind, a message, a requestId and a retryable flag, and the status says which family it is. The example prints the body so you can see them."],
    retry: ["Retries are yours to write", "Retry a 429 after the seconds in Retry-After, and a 5xx after a pause, always with the same Idempotency-Key. Do not retry a 400, 401, 403, 404 or 409: they will give the same answer. A generated Go client is available if you would rather not write that loop. {{F-SDK}}"],
    install: ["Any recent Go", "No module is needed for this file. The standard library does the whole job."],
  },
  php: {
    walk: [
      ["Only curl", "The example uses the curl functions that most PHP builds ship with, so there is nothing to install. {{F-API}}"],
      ["Build the JSON body", "json_encode makes the body from an array: the templateId and one party for seat signer_1. A template with two signers needs two parties. {{F-API}}"],
      ["Set the three headers", "Authorization carries the bearer key, Content-Type says JSON, and Idempotency-Key is made with random_bytes. Keep that value if you retry. {{F-API}}"],
      ["Check the status", "A status of 300 or more writes the body to standard error and exits 1; otherwise the program prints the answer, which holds the document's id and its state. {{F-SEND}}"],
    ],
    err: ["Read the error object yourself", "A failure comes back as a JSON object with a kind, a message, a requestId and a retryable flag. Decode it with json_decode and log the requestId."],
    retry: ["Retries are yours to write", "Retry a 429 after the seconds in Retry-After and a 5xx after a pause, with the same Idempotency-Key each time. A generated PHP client is available if you would rather not write that loop. {{F-SDK}}"],
    install: ["PHP with the curl extension", "Nothing to install. Check that curl is enabled in your PHP build."],
  },
  csharp: {
    walk: [
      ["Base libraries only", "The example uses System.Net.Http with top-level statements, so a one-file project on .NET 8 or newer is enough. {{F-API}}"],
      ["Build the JSON body", "The body is a short JSON string with the templateId and one party for seat signer_1. A real program would build it with System.Text.Json. {{F-API}}"],
      ["Set the headers", "Authorization carries the bearer key, the content is sent as application/json, and Idempotency-Key is a fresh Guid. Keep that value if you retry. {{F-API}}"],
      ["Check the status", "A response that is not a success throws with the status and the body; otherwise the program prints the answer, which holds the document's id and its state. {{F-SEND}}"],
    ],
    err: ["Parse the error body", "A failure comes back as a JSON object with a kind, a message, a requestId and a retryable flag. Deserialize it with the JSON library you already use and log the requestId."],
    retry: ["Write the retry around the request", "Retry a 429 after its Retry-After seconds and a 5xx after a pause, with the same Idempotency-Key each time. A generated C# client is available if you would rather not write that loop. {{F-SDK}}"],
    install: ["The .NET 8 SDK", "Nothing to install from a package feed. The .NET SDK builds and runs the file, and HttpClient is part of the base libraries."],
  },
};

export const langMore = (l) => {
  const x = SDK[l.slug];
  if (!x) return [];
  return [
    { t: "cols", eyebrow: "Line by line", h2: `What the ${l.name} program does.`, sub: "Read it once and you can change it with confidence.", cols: x.walk.map(([h, p]) => ({ h, p })) },
    { t: "cols", eyebrow: "When it goes wrong", h2: `Errors and retries in ${l.name}.`, sub: `Every error from the API has the same shape: ${ERR}.`, cols: [
      { h: x.err[0], p: `${x.err[1]} {{F-API}}` },
      { h: x.retry[0], p: `${x.retry[1]} {{F-API}}` },
      { h: "What is safe to retry", p: `In ${l.name}, as anywhere, a 429 and a 5xx are safe to retry with the same Idempotency-Key: sending the same request again never sends a second document. A 400, 401, 403, 404 or 409 will give the same answer every time, so fix the cause before you try again. {{F-API}}` },
    ] },
    { t: "cols", eyebrow: "Before you run it", h2: "What you need on hand.", sub: "Three things, none of them hard to get.", cols: [
      { h: x.install[0], p: `${x.install[1]} {{F-SDK}}` },
      { h: "A test key", p: `Make a key in the app under Developers, then API keys, and tick documents:read and documents:write. Give it to the ${l.name} program through DOCUSTAY_API_KEY. A key that starts dsk_test_ only does practice runs: the email goes to you and nothing counts. {{F-TESTMODE}}` },
      { h: "A template id", p: `Use your own copy of a built-in template, or one you made from HTML or a tagged PDF, and put its id in DOCUSTAY_TEMPLATE_ID before you run the ${l.name} file. Its seat names, such as signer_1, are what the parties in the request refer to. {{F-TEMPLATES}}` },
      { h: "Run it", p: `Save the program as send.${l.ext}${l.run ? ` and run ${l.run.join(" ").replace("{file}", "send." + l.ext)}` : ""}. It prints the document's id and its state, and the test email arrives in your own inbox within a minute or so. {{F-TESTMODE}}` },
    ] },
  ];
};
