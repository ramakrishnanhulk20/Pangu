/**
 * The five beats of the scroll story. The order here is the order on screen,
 * and the number is what the drawing reads to decide what it shows.
 */
export interface Beat {
  index: number;
  sentence: string;
}

export const BEATS: Beat[] = [
  { index: 1, sentence: "The curve sets the price" },
  { index: 2, sentence: "Every wallet has a cap" },
  { index: 3, sentence: "Only approved wallets, if the issuer wants" },
  { index: 4, sentence: "Buys stop above the real stock price" },
  { index: 5, sentence: "At graduation, or when the offering ends, the rules switch off" },
];

/**
 * Where the buying dot sits at the end of each beat, as a fraction of the whole
 * drawn journey: up the curve for the first four, out onto the flat line for
 * the last. The still version of the story places the dot from the same numbers
 * through --rider-x and --rider-y in globals.css.
 */
export const RIDER_STOPS = [0, 0.34, 0.42, 0.49, 0.6, 0.93];
