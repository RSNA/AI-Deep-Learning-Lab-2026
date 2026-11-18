# Art and fonts in this repository

Every file here is CC0, made for this project, or a font under the SIL Open Font License. Art under
any other license never enters the repository (engineering spec, section 11.4).

| File | Source | License |
| --- | --- | --- |
| `art-src/kenney-rpg-urban/tilemap_packed.png` | RPG Urban Pack by Kenney (kenney.nl) | CC0, see `art-src/kenney-rpg-urban/License.txt` |
| `public/art/sprites.png`, `public/art/avatars/*.png` | Built by `art-src/build_art.py` from the Kenney characters, some recolored | CC0 |
| `public/art/town_day.png`, `public/art/town_night.png` | Built by `art-src/build_art.py` from the Kenney street tiles | CC0 |
| `public/art/room/*` | The library branch of the demo pack, drawn by `art-src/build_art.py` for this project | Made for this project, MIT with the code |
| `public/fonts/jersey25-*.woff2` | Jersey 25 by The Soft Type Project | SIL Open Font License 1.1, see `public/fonts/OFL-Jersey25.txt` |
| `public/fonts/nunito-*.woff2` | Nunito by The Nunito Project Authors | SIL Open Font License 1.1, see `public/fonts/OFL-Nunito.txt` |

Rebuild the art with `npm run art` (Python 3 with Pillow). `build_art.py --room reading <folder>`
draws a radiology reading room for a pack's `art/room/` folder. A pack that brings `art/room/`
(`room_day.png`, `room_night.png`, `scene.json`) replaces the library room.
