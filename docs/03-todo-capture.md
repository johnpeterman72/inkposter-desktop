# Second capture — to unlock uploads, library, and login

The first capture gave us everything to *list* displays, read status, and *show*
existing items. To finish the app we need three more flows recorded. Same method
as before (ProxyPin on the iPhone → export HAR → drop in `docs/captures/`).

Do these deliberately, pausing a few seconds between each so the flows separate:

1. **Upload a personal photo and set it on the display.**
   - This is the big one. It reveals how a photo is uploaded and turned into an
     `itemId` (likely a create-item call + a binary image `PUT`/`POST`, possibly
     to a storage URL, then `show-on-frame`).
2. **Open your "my images" / gallery**, and **open the curated art library** and
   tap into a category.
   - Reveals the "list my items" and catalog endpoints so the app can browse
     instead of needing item IDs pasted by hand.
3. **Log out, then log back in.**
   - Reveals the login endpoint that mints the JWT, so the app can refresh its
     own token instead of relying on a 14-day capture.

Export the HAR and drop it in `docs/captures/`. Then tell me — I'll parse it with
`node docs/parse-har.js docs/captures/<newfile>.har` and wire up upload + browse
+ auto-login.

> Tip: a fresh capture also refreshes the auth token. After you export, I can pull
> the new token into `server/config.local.json` automatically.
