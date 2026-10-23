---
title: Send a document for signature from PHP
description: Send a document for signature from PHP, with a program that was run against Docustay with a test key.
---

# Send a document for signature from PHP

Sign PDF API in PHP: a short program that sends a template for signature, run against Docustay with a test key before it was published. Set DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID.

`composer require docustay/docustay-php`

The package needs PHP 7.4 or newer with the curl and json extensions, and uses Guzzle. The first argument of each call that creates something is an idempotency key: build one per attempt and reuse it when you retry. Pass the host only when you point at a self-hosted install.

```
<?php
require __DIR__ . '/vendor/autoload.php';

$config = Docustay\Configuration::getDefaultConfiguration()->setAccessToken(getenv('DOCUSTAY_API_KEY'));
if ($url = getenv('DOCUSTAY_URL')) {
    $config->setHost($url);
}
$api = new Docustay\Api\DocumentsApi(new GuzzleHttp\Client(), $config);

$request = new Docustay\Model\SendRequest([
    'template_id' => getenv('DOCUSTAY_TEMPLATE_ID'),
    'parties' => [new Docustay\Model\SendRequestPartiesInner([
        'seat' => 'signer_1', 'name' => 'Pat Example', 'email' => 'pat@example.com',
    ])],
]);
$doc = $api->sendDocument(bin2hex(random_bytes(16)), $request);
echo $doc->getId(), ' ', $doc->getState(), PHP_EOL;
```
