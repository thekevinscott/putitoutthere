export interface SpecifierClause {
  op: string;
  version: string;
}

export type VersionPredicate = (candidate: readonly number[], ver: readonly number[]) => boolean;
