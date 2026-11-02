import { Array as Arr } from "effect";
import { dual } from "effect/Function";

/**
 * `items` with the one at `from` moved to index `to`, the rest keeping their
 * order. An index out of range leaves the list as it was.
 */
export const moveItem: {
  (from: number, to: number): <A>(items: readonly A[]) => readonly A[];
  <A>(items: readonly A[], from: number, to: number): readonly A[];
} = dual(
  3,
  <A>(items: readonly A[], from: number, to: number): readonly A[] => {
    const item = items[from];

    if (item === undefined || from === to || to < 0 || to >= items.length) {
      return items;
    }

    const rest = Arr.filter(items, (_other, index) => index !== from);

    return [...Arr.take(rest, to), item, ...Arr.drop(rest, to)];
  }
);
