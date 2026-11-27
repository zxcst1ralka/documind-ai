
# Visual identity

DocuMind AI uses the visual idea of an optical reader. On the landing page,
a narrow violet light selects one line of a glass document. The example
turns that visual idea into a real interaction: selecting a question and
opening an answer source highlights the matching paragraph.

- **Palette.** Black #09090B, zinc #18181B, indigo #6366F1, violet #8B5CF6,
  green #10B981, amber #F59E0B and rose #F43F5E. Contrast-adjusted semantic
  tokens adapt controls, text and focus outlines to light and dark themes.
- **Typography.** Inter for interfaces and PT Serif for the editorial
  introduction and document preview.
- **Workspace.** The scan line recurs in the logo and the dashboard.
  Bibliographic details and citation numbers carry into the chat. Switching
  between sources changes the excerpt in the same panel on desktop and opens
  a focus-managed dialog on smaller screens.
- **Interaction.** Native buttons, visible pressed states and real links.
  Color and text both communicate status. The experience works without
  pointer-only gestures and respects reduced motion.

The design-system and React/accessibility searches were run using
[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
revision `11ca2b3`. The layout uses its asymmetric editorial and
high-contrast recommendations together with the palette from the brief.

The hero asset was created with built-in ImageGen and is stored at
`frontend/public/document-optics.webp`. ImageGen received the following prompt.

> Use case: stylized-concept. Asset: horizontal editorial hero photograph for DocuMind AI, a document-reading workspace. Art direction: an engineered tabletop optical instrument for reading a document. Photograph one beautiful, heavy, sharply rectangular stack of three translucent smoked-indigo glass plates shaped exactly like letter-sized paper, one luminous white engraved document sheet floating a little above the stack at a steep three-quarter perspective. Very thin straight lavender scanning light crosses the sheet, illuminating one engraved line and refracting through the thick glass with caustics. Read as sheets of a document immediately: a folded corner on the top glass page and purposeful tiny horizontal etching lines, no glyphs or pseudo letters. Refined hard-edged architectural product photography, macro optical glass, black studio backdrop near #09090B, blue-violet and cool white only, occasional fine indigo reflection, no pink. Compose product fully visible almost filling the centered frame (slightly toward upper right), keep margin around edges and keep dark lower right area for an HTML UI overlay. Deliberate strong shape, elegant richness and tangible texture, believable physically based metal and frosted glass, clean black edge falloff. No text, people, logos, floating icons, holographic UI, borders, watermarks, particles, portrait, or collage. Landscape 3:2 aspect ratio, bold but sober, visually arresting.
