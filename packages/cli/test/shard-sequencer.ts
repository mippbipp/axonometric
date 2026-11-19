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
 * Windows, from CI run 44582101536. Files not listed take `defaultSeconds`.
 * A file that grows or a new slow one only skews the split until someone
 * updates this table, and `shard-sequencer.test.ts` fails when a shard
 * holds more than 60% of the weight.
 */
export const fileSeconds = {
  "connection-page.test.ts": 96,
  "spotlight.test.ts": 85,
  "selection-edit.test.ts": 77,
  "readable-text-page.test.ts": 73,
  "rerouting.test.ts": 72,
  "export-svg.test.ts": 58,
  "export.test.ts": 46,
  "export-command.test.ts": 28,
  "group-chapter-page.test.ts": 27,
  "editing.test.ts": 25,
  "note-targets-page.test.ts": 21,
  "structure-follow.test.ts": 21,
  "structure-page.test.ts": 21,
  "text-page.test.ts": 20,
  "history-panel.test.ts": 18,
  "structures.test.ts": 17,
  "live-reload.test.ts": 16,
  "review-page.test.ts": 15,
  "drag-warnings-big-map.test.ts": 14,
  "sources.test.ts": 14,
  "font-width.test.ts": 13,
  "viewport.test.ts": 12,
  "plan-view.test.ts": 11,
  "edit-toggle.test.ts": 9,
} as const satisfies Readonly<Record<string, number>>;

export const defaultSeconds = 2.5;

const secondsByFile = new Map<string, number>(Rec.toEntries(fileSeconds));

/**
 * Shard 1 also runs the other packages' tests, which took 8% to 11% of the CLI
 * suite's time in that run. Counting 9% of it as already spent in shard 1
 * evens out the two jobs.
 */
const firstShardHeadStart = 0.09;

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
