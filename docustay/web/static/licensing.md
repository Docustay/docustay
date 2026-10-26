---
title: Licensing: AGPL or commercial licence
description: Docustay is open source under AGPL-3.0. Run it for your own business free, or with Self-host Pro. Embed, white-label, resell or fork it privately with a commercial licence.
---

# Licensing: AGPL or commercial.

Docustay is open source under AGPL-3.0. Most people never need anything else. If AGPL does not fit how you ship, there is a commercial licence. General information, not legal advice.

## Which licence fits?

Self-host Pro is $390 a year per install; a commercial licence is from about $3,000 a year.

## Three ways to use it.

| Item | Detail |
| --- | --- |
| Hosted by us | Free and Pro, used under the Terms. There is no code to license. |
| Run it yourself | Self-host Community is free under the AGPL-3.0. Self-host Pro adds the paid features for your own business, per install. |
| Ship it in a product | A commercial licence covers embedding, white-label, resale and a private fork. |

## What each one asks and gives.

- **Use**: You may run, study, change and share the code
- **Change it**: If you change the code and let others use your version over a network, offer them the source of your version
- **Run it unchanged**: For your own business there is nothing to publish
- **The text**: The LICENSE file is the authority; this is a summary

- **Embed**: Ship Docustay inside a product you sell or offer to others
- **White-label**: Your name and logo
- **Resell**: Offer it to your customers
- **Private fork**: Keep your changes without publishing them

## Using the API is not copying the code.

A customer who calls the Docustay API over HTTP, or uses the SDKs, is not making a derivative work of the server, and their software does not become AGPL. A customer who copies or modifies server code and lets other people use it over a network is, and the AGPL applies to that code. Showing the signing page inside your site in a frame is using a service. The SDKs, the signing element, the MCP server and the CLI are MIT.

## The code is yours to use; the name is not.

“Docustay” and the logo are marks of the Docustay project. The licences give you the right to use the code, not the name or the logo. If you fork the code, choose your own name and logo.

## What you are doing, and what you need.

| You are | Licence you need | Why |
| --- | --- | --- |
| Calling the API from your app | None to buy; the API is a service | Your code is not a derivative work of the server. |
| Using the SDKs or the CLI | MIT, nothing to buy | The pieces you put inside your own software carry the MIT licence. |
| Showing the signing page in a frame on your site | None to buy | It is using a service, not copying code. |
| Running Docustay for your own business | AGPL-3.0 (Community, free), or Self-host Pro | One install is one running Docustay with one database. |
| Changing the server code and letting others use it over a network | AGPL-3.0: offer them your version's source | That is what the AGPL asks. |
| Embedding Docustay in a product you offer to others | Commercial licence | Self-host Pro is for your own business only. |
| White-labelling or reselling it | Commercial licence | The name and logo are not covered by the code licences. |
| Keeping a private fork | Commercial licence | The AGPL would otherwise ask you to publish your changes to its users. |

## What counts as an install.

| Item | What to know |
| --- | --- |
| One install | One running Docustay with one database. |
| Staging or backup copy | A staging or backup copy of the same install is not a separate install. |
| Developer's machine | A development copy on a developer's own machine is not a separate install. |
| Two production databases | Two production databases are two installs, and each needs its own Pro key. |
| The key | One key covers one install and renews itself while the subscription is paid. |
| Where the check happens | On your machine, against the public key shipped with the install. |

## From card to running key.

| Step | What happens |
| --- | --- |
| 1. Pay on the Self-host page | Pay by card. When the payment is confirmed, a key is made and emailed once to the address on the payment. Only a fingerprint is kept, so it cannot be shown again. |
| 2. Add it to .env | Put DOCUSTAY_LICENSE_KEY in .env and run docker compose up -d. The install checks the key itself, on your machine. |
| 3. Renewal runs itself | A successful yearly payment extends the key to the end of the paid year plus 14 days of grace. An install with no route to the internet keeps working up to 30 days. |

## After you cancel.

| Item | What to know |
| --- | --- |
| Self-host Pro ends | The Pro items stop and the install keeps running as Community. Nothing is deleted. |
| Hosted Pro ends | The workspace moves to Free. Documents already sent or signed stay readable and downloadable. |
| Your data | You can export everything at any time. |
| Sending after a hosted cancel | Sending is limited by the Free limits. |

## Questions

**Does Self-host Pro cover embedding?**

No. It is for your own business. Embedding, white-labelling, resale and a private fork need a commercial licence.

**What if our server cannot reach yours?**

A Pro licence key keeps working for up to 30 days offline. It is a commercial honour system, not copy protection.

**Does using the API make my software AGPL?**

No. Calling the API or using the SDKs does not.

**Who owns contributions?**

Contributors keep their copyright and give the Docustay project a licence to use the change under any licence. That is what lets us offer a commercial licence next to the open one.


## Keep reading

- [Open source](/open-source)
- [Pricing](/pricing)
- [Self-host](/self-host)
