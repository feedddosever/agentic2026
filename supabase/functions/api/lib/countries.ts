// Countries most represented among Rome's visitors, with words that identify a document's nationality
// in operator notes (Italian and English). Used by the rule-based intake parser and embassy routing.
export type Country = { code: string; en: string; it: string; words: string[] };

export const COUNTRIES: Country[] = [
  { code: "US", en: "United States", it: "Stati Uniti", words: ["usa", "us", "american", "americano", "americana", "statunitense", "stati uniti"] },
  { code: "GB", en: "United Kingdom", it: "Regno Unito", words: ["uk", "british", "britannico", "britannica", "inglese", "regno unito", "english"] },
  { code: "FR", en: "France", it: "Francia", words: ["french", "francese", "francia", "france"] },
  { code: "DE", en: "Germany", it: "Germania", words: ["german", "tedesco", "tedesca", "germania", "germany"] },
  { code: "ES", en: "Spain", it: "Spagna", words: ["spanish", "spagnolo", "spagnola", "spagna", "spain"] },
  { code: "CN", en: "China", it: "Cina", words: ["chinese", "cinese", "cina", "china"] },
  { code: "JP", en: "Japan", it: "Giappone", words: ["japanese", "giapponese", "giappone", "japan"] },
  { code: "KR", en: "South Korea", it: "Corea del Sud", words: ["korean", "coreano", "coreana", "corea"] },
  { code: "BR", en: "Brazil", it: "Brasile", words: ["brazilian", "brasiliano", "brasiliana", "brasile", "brazil"] },
  { code: "AR", en: "Argentina", it: "Argentina", words: ["argentinian", "argentino", "argentina"] },
  { code: "MX", en: "Mexico", it: "Messico", words: ["mexican", "messicano", "messicana", "messico", "mexico"] },
  { code: "CA", en: "Canada", it: "Canada", words: ["canadian", "canadese", "canada"] },
  { code: "AU", en: "Australia", it: "Australia", words: ["australian", "australiano", "australiana", "australia"] },
  { code: "IN", en: "India", it: "India", words: ["indian", "indiano", "indiana", "india"] },
  { code: "NL", en: "Netherlands", it: "Paesi Bassi", words: ["dutch", "olandese", "olanda", "netherlands"] },
  { code: "BE", en: "Belgium", it: "Belgio", words: ["belgian", "belga", "belgio", "belgium"] },
  { code: "CH", en: "Switzerland", it: "Svizzera", words: ["swiss", "svizzero", "svizzera", "switzerland"] },
  { code: "AT", en: "Austria", it: "Austria", words: ["austrian", "austriaco", "austriaca", "austria"] },
  { code: "PL", en: "Poland", it: "Polonia", words: ["polish", "polacco", "polacca", "polonia", "poland"] },
  { code: "RO", en: "Romania", it: "Romania", words: ["romanian", "rumeno", "rumena", "romeno", "romania"] },
  { code: "UA", en: "Ukraine", it: "Ucraina", words: ["ukrainian", "ucraino", "ucraina", "ukraine"] },
  { code: "PT", en: "Portugal", it: "Portogallo", words: ["portuguese", "portoghese", "portogallo", "portugal"] },
  { code: "IE", en: "Ireland", it: "Irlanda", words: ["irish", "irlandese", "irlanda", "ireland"] },
  { code: "SE", en: "Sweden", it: "Svezia", words: ["swedish", "svedese", "svezia", "sweden"] },
  { code: "NO", en: "Norway", it: "Norvegia", words: ["norwegian", "norvegese", "norvegia", "norway"] },
  { code: "DK", en: "Denmark", it: "Danimarca", words: ["danish", "danese", "danimarca", "denmark"] },
  { code: "GR", en: "Greece", it: "Grecia", words: ["greek", "greco", "greca", "grecia", "greece"] },
  { code: "TR", en: "Türkiye", it: "Turchia", words: ["turkish", "turco", "turca", "turchia", "turkey"] },
  { code: "IL", en: "Israel", it: "Israele", words: ["israeli", "israeliano", "israeliana", "israele", "israel"] },
  { code: "PH", en: "Philippines", it: "Filippine", words: ["filipino", "filippino", "filippina", "filippine", "philippines"] },
  { code: "CO", en: "Colombia", it: "Colombia", words: ["colombian", "colombiano", "colombiana", "colombia"] },
  { code: "PE", en: "Peru", it: "Perù", words: ["peruvian", "peruviano", "peruviana", "peru", "perù"] },
  { code: "EG", en: "Egypt", it: "Egitto", words: ["egyptian", "egiziano", "egiziana", "egitto", "egypt"] },
  { code: "MA", en: "Morocco", it: "Marocco", words: ["moroccan", "marocchino", "marocchina", "marocco", "morocco"] },
  { code: "BD", en: "Bangladesh", it: "Bangladesh", words: ["bangladeshi", "bengalese", "bangladesh"] },
  { code: "AL", en: "Albania", it: "Albania", words: ["albanian", "albanese", "albania"] },
  { code: "RU", en: "Russia", it: "Russia", words: ["russian", "russo", "russa", "russia"] },
  { code: "ZA", en: "South Africa", it: "Sudafrica", words: ["south african", "sudafricano", "sudafricana", "sudafrica"] },
  { code: "NZ", en: "New Zealand", it: "Nuova Zelanda", words: ["new zealand", "neozelandese", "nuova zelanda"] },
  { code: "TW", en: "Taiwan", it: "Taiwan", words: ["taiwanese", "taiwan"] },
];

export const countryByCode = (code?: string | null) => COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase()) ?? null;

export function detectCountry(text: string): Country | null {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, " ")} `;
  // Prefer the longest matching phrase (e.g. "south african" over nothing).
  let best: { c: Country; len: number } | null = null;
  for (const c of COUNTRIES) {
    for (const w of c.words) {
      if (w.length <= 2 ? new RegExp(`\\s${w}\\s`).test(t) : t.includes(` ${w} `) || t.includes(` ${w}`)) {
        if (!best || w.length > best.len) best = { c, len: w.length };
      }
    }
  }
  return best?.c ?? null;
}
