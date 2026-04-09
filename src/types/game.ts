export interface ExtraContent {
  label: string;
  items: string[];
}

export interface Game {
  title: string;
  subtitle: string | null;
  platforms: string[];
  extras: ExtraContent[];
  sgdbId: number | null;
  coverOverride: string | null;
}

export interface CoverEntry {
  sgdbId: number | null;
  file: string;
  fetchedAt: string;
}

export type CoverMap = Record<string, CoverEntry | null>;

export interface GameWithCover extends Game {
  coverUrl: string | null;
}

export interface LetterGroup {
  letter: string;
  games: GameWithCover[];
}
