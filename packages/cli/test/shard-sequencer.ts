import {
  Array as Arr,
  Option,
  Order,
  Record as Rec,
  String as Str,
} from "effect";
import { BaseSequencer } from "vitest/node";
import type { TestSpecification } from "vitest/node";

/**
 * Seconds a test file takes on a CI runner, averaged over Linux, macOS and
 * Windows, from two sharded CI runs, 44635861872 and 44637425745.
 * Files not listed take `defaultSeconds`.
 * A file that grows or a new slow one only skews the split until someone
 * updates this table, and `shard-sequencer.test.ts` fails when a shard
 * holds more than 60% of the weight.
 */
export const fileSeconds = {
  "connection-page.test.ts": 75,
  "readable-text-page.test.ts": 73,
  "selection-edit.test.ts": 56,
  "rerouting.test.ts": 50,
  "export.test.ts": 49,
  "export-svg.test.ts": 48,
  "editing.test.ts": 29,
  "export-command.test.ts": 27,
  "structure-follow.test.ts": 24,
  "group-chapter-page.test.ts": 23,
  "structure-page.test.ts": 20,
  "structures.test.ts": 19,
  "text-page.test.ts": 19,
  "note-targets-page.test.ts": 17,
  "live-reload.test.ts": 16,
  "history-panel.test.ts": 15,
  "font-width.test.ts": 12,
  "review-page.test.ts": 12,
  "drag-warnings-big-map.test.ts": 11,
  "viewport.test.ts": 11,
  "plan-view.test.ts": 9,
  "edit-toggle.test.ts": 8,
} as const satisfies Readonly<Record<string, number>>;

export const defaultSeconds = 2.5;

const secondsByFile = new Map<string, number>(Rec.toEntries(fileSeconds));

/**
 * Shard 1 also runs the other packages' tests, which took about 5% of the CLI
 * suite's time (after the other jobs' setup). Counting 5% of it as already spent in shard 1 evens out the two jobs.
 */
const firstShardHeadStart = 0.05;

export const weight = (file: string): number => {
  const name = Option.getOrElse(
    Arr.last(Str.split(/[\\/]/u)(file)),
    () => file
  );

  return secondsByFile.get(name) ?? defaultSeconds;
};

interface Group {
  readonly seconds: number;
  readonly files: readonly string[];
}

const bySeconds = Order.mapInput(Order.Number, (group: Group) => group.seconds);

/**
 * Splits files into `count` groups of near-equal weight: the heaviest file
 * goes to the lightest group so far. The same files always give the same
 * groups, which every shard job computes on its own.
 */
export const splitByWeight = (
  files: readonly string[],
  count: number
): readonly (readonly string[])[] => {
  const total = Arr.reduce(files, 0, (sum, file) => sum + weight(file));

  const empty = Arr.makeBy(count, (index): Group => ({
    seconds: index === 0 ? total * firstShardHeadStart : 0,
    files: [],
  }));

  const heaviestFirst = Arr.sort(
    Arr.sort(files, Order.String),
    Order.flip(Order.mapInput(Order.Number, weight))
  );

  const groups = Arr.reduce(heaviestFirst, empty, (all, file) => {
    const [lightest] = Arr.sort(all, bySeconds);

    return Arr.map(all, (group) =>
      group === lightest
        ? {
            seconds: group.seconds + weight(file),
            files: [...group.files, file],
          }
        : group
    );
  });

  return Arr.map(groups, (group) => group.files);
};

/**
 * Vitest's own `--shard` cuts files by a hash of their path, so a shard can
 * draw most of the slow files. This one splits by `fileSeconds`.
 */
export default class WeightedShardSequencer extends BaseSequencer {
  public override shard(
    files: TestSpecification[]
  ): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };

    const groups = splitByWeight(
      Arr.map(files, (spec) => spec.moduleId),
      count
    );

    const mine = new Set(groups[index - 1]);

    return Promise.resolve(
      Arr.filter(files, (spec) => mine.has(spec.moduleId))
    );
  }
}
