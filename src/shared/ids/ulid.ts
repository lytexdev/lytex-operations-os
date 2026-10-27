/**
 * ULID generator (https://github.com/ulid/spec), dependency-free.
 * Monotonic within the same millisecond so IDs created in a tight loop still sort correctly.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const defaultRandom: RandomSource = (bytes) => {
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffffffffffff) {
    throw new RangeError(`ULID time out of range: ${ms}`);
  }
  let out = '';
  let rest = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = rest % 32;
    out = ALPHABET[mod] + out;
    rest = (rest - mod) / 32;
  }
  return out;
}

function randomChars(random: RandomSource): number[] {
  const bytes = random(new Uint8Array(RANDOM_LEN));
  return Array.from(bytes, (b) => b % 32);
}

function incrementChars(chars: number[]): number[] {
  const next = [...chars];
  for (let i = next.length - 1; i >= 0; i--) {
    const v = next[i]!;
    if (v < 31) {
      next[i] = v + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error('ULID random component overflow');
}

export class UlidFactory {
  private lastTime = -1;
  private lastRandom: number[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: RandomSource = defaultRandom,
  ) {}

  next(): string {
    let time = this.now();
    if (time <= this.lastTime) {
      // Same millisecond or clock moved backwards: keep monotonic ordering.
      time = this.lastTime;
      this.lastRandom = incrementChars(this.lastRandom);
    } else {
      this.lastTime = time;
      this.lastRandom = randomChars(this.random);
    }
    return encodeTime(time) + this.lastRandom.map((c) => ALPHABET[c]).join('');
  }
}

const shared = new UlidFactory();

export function ulid(): string {
  return shared.next();
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function ulidTime(value: string): number {
  if (!isUlid(value)) throw new Error(`Not a ULID: ${value}`);
  let ms = 0;
  for (const ch of value.slice(0, TIME_LEN)) ms = ms * 32 + ALPHABET.indexOf(ch);
  return ms;
}
