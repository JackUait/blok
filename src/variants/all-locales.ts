/**
 * Static imports for all 68 locales.
 *
 * This file forces Vite to bundle all locale JSON files instead of code-splitting them.
 * It's only used for the "maximum" bundle size measurement variant.
 *
 * This file is NOT part of the public API.
 */

// Static imports for all locale message files
import am from '../components/i18n/locales/am/messages.json';
import ar from '../components/i18n/locales/ar/messages.json';
import az from '../components/i18n/locales/az/messages.json';
import bg from '../components/i18n/locales/bg/messages.json';
import bn from '../components/i18n/locales/bn/messages.json';
import bs from '../components/i18n/locales/bs/messages.json';
import cs from '../components/i18n/locales/cs/messages.json';
import da from '../components/i18n/locales/da/messages.json';
import de from '../components/i18n/locales/de/messages.json';
import dv from '../components/i18n/locales/dv/messages.json';
import el from '../components/i18n/locales/el/messages.json';
import en from '../components/i18n/locales/en/messages.json';
import es from '../components/i18n/locales/es/messages.json';
import et from '../components/i18n/locales/et/messages.json';
import fa from '../components/i18n/locales/fa/messages.json';
import fi from '../components/i18n/locales/fi/messages.json';
import fil from '../components/i18n/locales/fil/messages.json';
import fr from '../components/i18n/locales/fr/messages.json';
import gu from '../components/i18n/locales/gu/messages.json';
import he from '../components/i18n/locales/he/messages.json';
import hi from '../components/i18n/locales/hi/messages.json';
import hr from '../components/i18n/locales/hr/messages.json';
import hu from '../components/i18n/locales/hu/messages.json';
import hy from '../components/i18n/locales/hy/messages.json';
import id from '../components/i18n/locales/id/messages.json';
import it from '../components/i18n/locales/it/messages.json';
import ja from '../components/i18n/locales/ja/messages.json';
import ka from '../components/i18n/locales/ka/messages.json';
import km from '../components/i18n/locales/km/messages.json';
import kn from '../components/i18n/locales/kn/messages.json';
import ko from '../components/i18n/locales/ko/messages.json';
import ku from '../components/i18n/locales/ku/messages.json';
import lo from '../components/i18n/locales/lo/messages.json';
import lt from '../components/i18n/locales/lt/messages.json';
import lv from '../components/i18n/locales/lv/messages.json';
import mk from '../components/i18n/locales/mk/messages.json';
import ml from '../components/i18n/locales/ml/messages.json';
import mn from '../components/i18n/locales/mn/messages.json';
import mr from '../components/i18n/locales/mr/messages.json';
import ms from '../components/i18n/locales/ms/messages.json';
import my from '../components/i18n/locales/my/messages.json';
import ne from '../components/i18n/locales/ne/messages.json';
import nl from '../components/i18n/locales/nl/messages.json';
import no from '../components/i18n/locales/no/messages.json';
import pa from '../components/i18n/locales/pa/messages.json';
import pl from '../components/i18n/locales/pl/messages.json';
import ps from '../components/i18n/locales/ps/messages.json';
import pt from '../components/i18n/locales/pt/messages.json';
import ro from '../components/i18n/locales/ro/messages.json';
import ru from '../components/i18n/locales/ru/messages.json';
import sd from '../components/i18n/locales/sd/messages.json';
import si from '../components/i18n/locales/si/messages.json';
import sk from '../components/i18n/locales/sk/messages.json';
import sl from '../components/i18n/locales/sl/messages.json';
import sq from '../components/i18n/locales/sq/messages.json';
import sr from '../components/i18n/locales/sr/messages.json';
import sv from '../components/i18n/locales/sv/messages.json';
import sw from '../components/i18n/locales/sw/messages.json';
import ta from '../components/i18n/locales/ta/messages.json';
import te from '../components/i18n/locales/te/messages.json';
import th from '../components/i18n/locales/th/messages.json';
import tr from '../components/i18n/locales/tr/messages.json';
import ug from '../components/i18n/locales/ug/messages.json';
import uk from '../components/i18n/locales/uk/messages.json';
import ur from '../components/i18n/locales/ur/messages.json';
import vi from '../components/i18n/locales/vi/messages.json';
import yi from '../components/i18n/locales/yi/messages.json';
import zh from '../components/i18n/locales/zh/messages.json';

/**
 * All locale dictionaries as a record.
 * Exporting this ensures the imports are not tree-shaken.
 */
export const allLocales = {
  am,
  ar,
  az,
  bg,
  bn,
  bs,
  cs,
  da,
  de,
  dv,
  el,
  en,
  es,
  et,
  fa,
  fi,
  fil,
  fr,
  gu,
  he,
  hi,
  hr,
  hu,
  hy,
  id,
  it,
  ja,
  ka,
  km,
  kn,
  ko,
  ku,
  lo,
  lt,
  lv,
  mk,
  ml,
  mn,
  mr,
  ms,
  my,
  ne,
  nl,
  no,
  pa,
  pl,
  ps,
  pt,
  ro,
  ru,
  sd,
  si,
  sk,
  sl,
  sq,
  sr,
  sv,
  sw,
  ta,
  te,
  th,
  tr,
  ug,
  uk,
  ur,
  vi,
  yi,
  zh,
};

export const localeCount = Object.keys(allLocales).length;
