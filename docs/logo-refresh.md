# September 2026 logo refresh

24 existing identities were updated and nine missing team identities were
filled. Original artwork and retrieval URLs are recorded in
[crest-sources.json](crest-sources.json). Review every changed team at
[the crest review page](../dev/crest-review.html), which uses the production
renderer at result-card and table-row sizes across all ten themes.

## Updated

- Premiership: Newcastle Red Bulls, Northampton Saints and Saracens.
- URC: Cardiff Rugby, Connacht, Dragons RFC, Stormers, Zebre Parma, Bulls,
  Lions, Sharks and Ospreys.
- Top 14: Bayonne, Castres, Bordeaux Bègles, Pau, Stade Français, Toulon and
  Toulouse. Alternate provider IDs for Bayonne, Pau and UBB share the same files.
- Other: Western Force, Canada, France, Samoa and Hong Kong China. Hong Kong
  previously pointed at Honduras's flag.

## Filled

Bristol Bears, US Montauban, Black Lion, Black Ferns, AUNZ XV and First Nations
& Pasifika XV now have local artwork. Ireland Women, Japan Women and South
Africa Women share their corresponding national union crests. Black Ferns use
their own wordmark, not the All Blacks crest.

The 2026 anniversary versions for Brumbies and Highlanders were not substituted
for permanent club badges. Argentina's existing Los Pumas badge was already
current. Other unconfirmed audit entries were not replaced speculatively.

## Source choices and resolution

Most artwork comes directly from official club, union or league sites. Hong
Kong China's vector paths were extracted from the badge on page 1 of its
official 22 June 2025 match programme, preserving fills and proportions. Canada
uses the `logo-red` symbol extracted from Rugby Canada's SVG sprite.

Black Lion uses the vector hosted by French Wikipedia, matching the existing
club identity. AUNZ XV and First Nations & Pasifika XV use RugbyPass artwork.
Black Ferns use Weston Design's 600px black version, visually matched to the
official team logo; the white website-header version vanishes on light themes.
The Sharks use the current URC competition wordmark, and Western Force uses
the full-colour badge currently shown on its official fixture list.

AUNZ XV's best confirmed transparent source is still only 120×120. It is useful
at table-row size but remains soft when enlarged. Samoa's original is 213×290,
slightly below the 320px export target. The existing user-supplied Perpignan
source remains 96×96. The rendering script does not pretend that upscaling
these sources creates additional detail.

## Refresh persistence

Keep originals in `assets/crest-sources/` and mappings in
`scripts/crest-overrides.json`. `npm run refresh` already reapplies them after
the provider's crest mirror, including blank provider logos and aliases.
The render assets are generated at 96px and 320px; the team-colour and
crest-plating models are then rebuilt. No runtime image requests to external
sites are needed. Team names and historical match data are unchanged.

The manifest's `plating` entries explicitly set the themes that need a
background for Western Force and Zebre. The automatic detector mistakes the
swan for a harmless rim, and rejects Zebre's background because of its yellow
lettering even though it restores the navy zebra and wordmark. These two
exceptions were checked visually; global contrast thresholds are unchanged.

After replacing an original, run:

```sh
npm run crests:manual
npm run colours
npm run plating
npm run verify
```

Review the generated images as well as test results.
