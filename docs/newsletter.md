# Newsletter sign-up

`/subscribe` passes a verified sign-up on to a list in Notifuse. Its address, workspace and lists are set per site - never taken from the request, so nobody can be put on another list.

```html
<form action="https://altcha.example.com/subscribe" method="post">
  <input name="email" type="email" required>
  <input name="name">
  <input name="language" type="hidden" value="en">
  <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
  <altcha-widget challenge="https://altcha.example.com/challenge"></altcha-widget>
  <button type="submit">Subscribe</button>
</form>
```

- Only `email`, `name` (as the full name) and `language` reach Notifuse; every other field is dropped. An invalid address is refused as `email_invalid` before the solution is spent, so the visitor can correct it without solving again.
- The lists have to be public in Notifuse. With double opt-in on the list, Notifuse mails the confirmation link itself.
- Lists per language: a sign-up whose `language` has lists of its own at the site goes there instead (`de-at` falls back to `de`, `es-419` to `es`).
- The service posts to the public `/subscribe` of Notifuse, no API key - in the same Docker network for example `http://notifuse:8080`. Notifuse sees the address of this service, not the visitor's.
- Workspace and list ids never appear in the page. Notifuse's own `/subscribe` stays reachable - its confirmation page needs it - so keep its rate limits.
- Rate limits, redirect pages and honeypot work as for `/submit`; a site can have both.
