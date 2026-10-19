# Notifuse webhook

Part of the [ALTCHA service](../README.md).

Notifuse reports what happens on its lists through webhooks. The service takes these deliveries on its admin port and
turns every list event into one mail to `NOTIFUSE_NOTIFY_TO` - for example a mail for each sign-up confirmed by double
opt-in.

## Setting it up

1. Create a webhook in Notifuse - in the console, or with `POST /api/webhookSubscriptions.create`:
   - **URL**: the admin port as Notifuse reaches it, path `/notifuse/webhook` - in the same Docker network for example
     `http://altcha:8081/notifuse/webhook`. The admin port stays off the internet, as it should.
   - **Events**: `list.confirmed` for confirmed sign-ups. Every other `list.*` event is mailed too when it is chosen;
     `list.subscribed` also fires for each contact imported straight into a list.
   - **Lists**: optional, to narrow it down to some lists.
2. Notifuse shows the signing secret (`whsec_…`) once, when the webhook is created. Give it to the service as
   `NOTIFUSE_WEBHOOK_SECRET` or, better, as a file in `NOTIFUSE_WEBHOOK_SECRET_FILE`. Each workspace has a webhook of
   its own, with its own secret: list them separated by spaces or commas.
3. Set `NOTIFUSE_NOTIFY_TO` to the address that gets the mails. They go out like the form mails, from `SMTP_FROM` -
   without `SMTP_HOST` the service refuses to start.
4. After the restart the log says `Notifuse webhook on the admin port at /notifuse/webhook`. The test of the webhook in
   Notifuse with the event type `list.confirmed` sends a sample, which arrives as a mail about `test@example.com`.

## The mail

The subject says what happened and on which list (`Subscription confirmed: Newsletter`). The body has the address, the
list, the status before and after, and the event, workspace and delivery id. The address is never put into a header.

| Event | Subject |
|---|---|
| `list.subscribed` | New subscriber |
| `list.confirmed` | Subscription confirmed |
| `list.resubscribed` | Subscribed again |
| `list.pending` | Waiting for confirmation |
| `list.unsubscribed` | Unsubscribed |
| `list.bounced` | Address bounced |
| `list.complained` | Marked as spam |
| `list.removed` | Removed from the list |

Events of other kinds - contacts, segments, messages, custom events - are acknowledged and dropped.

## What is checked

The route needs no sign-in of the admin port; Notifuse could not do one. Instead every delivery carries a signature
after [Standard Webhooks](https://www.standardwebhooks.com): an HMAC-SHA256 with the secret over the delivery id, the
timestamp and the body.

- **Without a valid signature nothing happens** - the answer is `401`. While a secret is being replaced, one valid
  signature among several is enough.
- **A timestamp more than five minutes off is refused**, so a recorded delivery cannot be sent again later. The clocks of
  both machines have to be right.
- **A delivery id is mailed once.** A retry of Notifuse after a lost answer is acknowledged without a second mail; the
  ids are kept in memory for 24 hours.
- Without `NOTIFUSE_WEBHOOK_SECRET` the path does not exist.

## Answers

| Status | Body | Notifuse |
|---|---|---|
| `200` | `{"ok":true,"mailed":true}` | delivered |
| `200` | `{"ok":true,"mailed":false,"reason":"ignored"}` - not a list event, or `"duplicate"` - mailed before | delivered |
| `401` | `webhook_headers`, `webhook_signature` or `webhook_timestamp` | tries again |
| `409` | `in_progress` - the same delivery is still at the mail server | tries again |
| `502` | `delivery_failed` - the mail server did not take the mail | tries again |

Notifuse keeps trying for about ten hours and switches a webhook off after many failures in a row - switch it on again in
Notifuse once the cause is fixed. `altcha_notifuse_webhooks_total` counts the outcomes (`mailed`, `ignored`,
`duplicate`, `refused`, `failed`); the log names the event type and never the address.
