
# Visual identity

DocuMind AI uses the visual idea of an archival optical reader. A thin copper
beam crosses the top page in the landing illustration. In the interactive
example, opening an answer's source highlights the corresponding paragraph.

- **Palette.** Forest #101915 and pistachio #B8DBA6 define the dark theme.
  Sage #F3F5EE and moss #2D553C define the light theme. Copper marks citations
  and paper #F0ECDF frames document excerpts in the dark theme. Semantic tokens
  adapt controls, text and focus outlines for each theme.
- **Typography.** Unbounded sets major headings. Manrope sets interfaces and
  excerpts. Both variable fonts support Cyrillic and are served locally.
- **Action placement.** The landing page gives workspace creation its own
  button and puts the example link below the illustration. The dashboard
  emphasizes upload and lists chat and version comparison separately. The
  document reader places questions next to the reading area and the original
  download in the metadata panel.
- **Sources.** The public example shows the questions, answer and excerpt side by
  side when space permits. In chat, selecting a citation updates the source
  panel on desktop and opens a focus-managed dialog on smaller screens.
- **Interaction.** Native buttons, visible pressed states and real links.
  Color and text both communicate status. The experience works without
  pointer-only gestures and respects reduced motion.

The initial design used [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
at revision `11ca2b3`. The redesign used the layout, typesetting and color guides
from [Impeccable](https://impeccable.style/) and the motion guidance from
[Taste Skill](https://github.com/Leonxlnx/taste-skill) 2.5.1.

The hero asset was created with built-in ImageGen and is stored at
`frontend/public/archive-optics.webp`. ImageGen received the following prompt.

> Use case: stylized-concept. Asset: a 3:2 horizontal hero image for a premium document research workspace, an original studio product still life. An optical reading table in a dark moss-green archive. Three substantial archival document folios of precisely folded ivory paper, partially overlapping, tilt diagonally over a thick etched slab of translucent dark malachite glass; visible offset sheet corners make the form unmistakably a stack of documents. Just one thin warm copper-amber line of light identifies a single line across the top page. A subtle cool jade edge highlight outlines the glass. The page surface shows restrained embossed rows and one line under the beam, no readable characters. Real editorial product photography, straight orthographic-leaning three-quarter angle from slightly above, strong negative space in upper-left, object floating over a nearly black forest-green seamless background, visible material grain, soft texture in paper, convincing optical refraction. Place paper subject slightly right of center and allow full object silhouette to breathe. Contrast between warm cream paper, earthy green, graphite black, and one copper scanning stroke. Inspired by the material precision of design museum photography. Keep only the object and light. No electronics monitor or interface, no badges, no logos, no typography, no violet or blue cast, no sparkling particles, no science-fiction panels, no gloss overload, no watermarks.
