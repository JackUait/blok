/**
 * Word's non-Latin list formats, written the way the CSS counter styles the old
 * renderer used draw them (CSS Counter Styles Level 3).
 */

interface Counting {
  /** Digits 0–9. */
  digits: string;
  /** 十, 百, 千 (or their equivalents). */
  units: [string, string, string];
  /** Written for a run of zero digits between non-zero ones, or null when skipped. */
  zero: string | null;
  /** Which `1` digits before a unit are dropped: none, only a leading 十, or all. */
  dropOne: 'none' | 'leading-ten' | 'all';
}

const CHINESE: Counting = { digits: '零一二三四五六七八九', units: ['十', '百', '千'], zero: '零', dropOne: 'leading-ten' };
const JAPANESE: Counting = { digits: '〇一二三四五六七八九', units: ['十', '百', '千'], zero: null, dropOne: 'all' };
const KOREAN: Counting = { digits: '영일이삼사오육칠팔구', units: ['십', '백', '천'], zero: null, dropOne: 'none' };

const COUNTING: Record<string, Counting> = {
  chineseCounting: CHINESE,
  chineseCountingThousand: CHINESE,
  taiwaneseCounting: CHINESE,
  taiwaneseCountingThousand: CHINESE,
  japaneseCounting: JAPANESE,
  koreanDigital2: JAPANESE,
  koreanCounting: KOREAN,
  koreanDigital: KOREAN,
  chineseLegalSimplified: { digits: '零壹贰叁肆伍陆柒捌玖', units: ['拾', '佰', '仟'], zero: '零', dropOne: 'none' },
  ideographLegalTraditional: { digits: '零壹貳參肆伍陸柒捌玖', units: ['拾', '佰', '仟'], zero: '零', dropOne: 'none' },
  japaneseLegal: { digits: '零壱弐参四伍六七八九', units: ['拾', '百', '阡'], zero: null, dropOne: 'none' },
};

/** Formats that swap each decimal digit for a native one. */
const DIGITS: Record<string, string> = {
  thaiNumbers: '๐๑๒๓๔๕๖๗๘๙',
  hindiNumbers: '०१२३४५६७८९',
  ideographDigital: '〇一二三四五六七八九',
  japaneseDigitalTenThousand: '〇一二三四五六七八九',
};

const KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲン';
const IROHA = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス';

/** Alphabetic formats: the letters in order, then pairs, as `a, b … z, aa`. */
const ALPHABETS: Record<string, string> = {
  aiueo: KATAKANA,
  aiueoFullWidth: KATAKANA,
  iroha: IROHA,
  irohaFullWidth: IROHA,
  ganada: '가나다라마바사아자차카타파하',
  chosung: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ',
  ideographTraditional: '甲乙丙丁戊己庚辛壬癸',
  ideographZodiac: '子丑寅卯辰巳午未申酉戌亥',
};

/** Hebrew additive values. */
const HEBREW: Array<[number, string]> = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
  [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'],
  [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
];
/** 15 and 16 are written 9+6 and 9+7, so they never spell a name of God. */
const HEBREW_SPECIAL: Record<number, string> = { 15: 'טו', 16: 'טז' };

const MAX_COUNTING = 9999;
const MAX_HEBREW = 999;

function counting(n: number, style: Counting): string {
  const places = String(n).split('').map(Number).reverse();
  const out: string[] = [];
  places.forEach((digit, place) => {
    const leading = place === places.length - 1;
    if (digit === 0) {
      // One zero mark for a gap, never at the end and never twice in a row.
      const gap = style.zero !== null && place > 0 && out.length > 0 && out[0] !== style.zero;
      if (gap && style.zero !== null) {
        out.unshift(style.zero);
      }

      return;
    }
    const unit = place === 0 ? '' : style.units[place - 1];
    const dropped = digit === 1 && place > 0
      && (style.dropOne === 'all' || (style.dropOne === 'leading-ten' && place === 1 && leading));
    out.unshift((dropped ? '' : style.digits[digit]) + unit);
  });

  return out.join('');
}

function alphabetic(n: number, letters: string): string {
  const chars = Array.from(letters);
  const out: string[] = [];
  const rest = { n };
  while (rest.n > 0) {
    rest.n -= 1;
    out.unshift(chars[rest.n % chars.length]);
    rest.n = Math.floor(rest.n / chars.length);
  }

  return out.join('');
}

function hebrew(n: number): string {
  const out: string[] = [];
  const tail = n % 100;
  const special = Object.hasOwn(HEBREW_SPECIAL, tail) ? HEBREW_SPECIAL[tail] : '';
  HEBREW.reduce((rest, [value, letters]) => {
    const times = Math.floor(rest / value);
    out.push(letters.repeat(times));

    return rest - times * value;
  }, special === '' ? n : n - tail);

  return out.join('') + special;
}

/** `n` in a non-Latin Word list format, or null when the format is not one of them or `n` is out of its range. */
export function listFormat(n: number, format: string): string | null {
  if (n < 1) {
    return null;
  }
  if (Object.hasOwn(COUNTING, format)) {
    return n > MAX_COUNTING ? null : counting(n, COUNTING[format]);
  }
  if (Object.hasOwn(DIGITS, format)) {
    const digits = Array.from(DIGITS[format]);

    return String(n).split('').map((d) => digits[Number(d)]).join('');
  }
  if (Object.hasOwn(ALPHABETS, format)) {
    return alphabetic(n, ALPHABETS[format]);
  }
  if (format === 'hebrew1' || format === 'hebrew2') {
    return n > MAX_HEBREW ? null : hebrew(n);
  }

  return null;
}
