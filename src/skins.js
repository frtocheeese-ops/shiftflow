// Dostupné vzhledy (skiny). Přidání nového skinu:
//   1) záznam sem (pořadí = pořadí při přepínání tlačítkem),
//   2) blok [data-theme="<id>"]{…} v CSS v App.jsx,
//   3) případné soubory do public/skins/<id>/,
//   4) případná vlastní písma: pole fonts (odkaz na Google Fonts, načte se až při zapnutí).
// Tlačítko v hlavičce / postranním menu přepíná dokola na DALŠÍ vzhled v tomto seznamu.
export const SKINS = [
  { id: "light", name: "Světlý", icon: "○", sub: "původní světlý vzhled", swatch: "linear-gradient(135deg, #e3e7ee, #bec4d0)" },
  { id: "dark", name: "Tmavý", icon: "●", sub: "původní tmavý vzhled", swatch: "linear-gradient(135deg, #0c0c12, #d47820)" },
  { id: "sever", name: "Sever", icon: "❄", sub: "kámen, dřevo, kůže a námraza", swatch: "linear-gradient(135deg, #1e2831, #8fc3e6)",
    fonts: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Alegreya+Sans:wght@400;500;700&display=swap" },
  { id: "nebula", name: "Vesmírná nebula", icon: "✦", sub: "mlhovina, hvězdy, sklo a planety", swatch: "linear-gradient(135deg, #12082e, #8b6bff 55%, #e04dff)",
    fonts: "https://fonts.googleapis.com/css2?family=Exo+2:wght@600;700;800&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" },
  { id: "temny", name: "Temný věk", icon: "✠", sub: "inkoust, papír a mangové bubliny", swatch: "linear-gradient(135deg, #141210, #9c1b1b 60%, #e9e3d4)",
    fonts: "https://fonts.googleapis.com/css2?family=MedievalSharp&family=Alegreya+Sans:wght@400;500;700&family=Courier+Prime:wght@400;700&display=swap" },
  { id: "arkanum", name: "Arkánum", icon: "☾", sub: "kouzelná škola: hrad, svitky, pečeti a knihy", swatch: "linear-gradient(135deg, #0b0f1f, #e3c26a 60%, #7a1f2b)",
    fonts: "https://fonts.googleapis.com/css2?family=Eagle+Lake&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" },
];
export const skinOf = id => SKINS.find(s => s.id === id) || SKINS[0];
export const nextSkin = id => SKINS[(SKINS.findIndex(s => s.id === id) + 1) % SKINS.length].id;
