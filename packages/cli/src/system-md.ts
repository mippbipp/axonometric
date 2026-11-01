import {
  normalSourcePath,
  sourceKey,
  statusLabels,
  uniqueSources,
} from "@axonometric/contracts";
import type {
  Hop,
  MapData,
  MapState,
  Question,
  Source,
  Structure,
} from "@axonometric/contracts";
import {
  Array as Arr,
  Option,
  Result,
  Schema,
  String as Str,
  pipe,
} from "effect";
import { dual } from "effect/Function";

/** Keeps a value on one line inside a Markdown table cell. */
const cell = (text: string) =>
  pipe(
    text,
    Str.replaceAll("\\", String.raw`\\`),
    Str.replaceAll("|", String.raw`\|`),
    Str.replaceAll(/\s+/gu, " ")
  );

const encodeJson = Schema.encodeResult(Schema.fromJsonString(Schema.Json));

const code = (text: string) => `\`${Str.replaceAll("`", "'")(text)}\``;

const payloadCell = (payload: Schema.Json | undefined) => {
  if (payload === undefined) {
    return "";
  }

  const json = Result.getOrElse(encodeJson(payload), String);

  return cell(code(json));
};

const row = (cells: readonly string[]) => `| ${Arr.join(cells, " | ")} |`;

const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[]
) => [row(header), row(Arr.map(header, () => "---")), ...Arr.map(rows, row)];

/** Drops blank lines from the end of `lines`. */
const trimBlank = (lines: readonly string[]) => {
  const last = Arr.findLastIndex(lines, (line) => line !== "");

  return Option.match(last, {
    onNone: () => [],
    onSome: (index) => lines.slice(0, index + 1),
  });
};

/**
 * A section: its heading, its body and one blank line, or nothing when the
 * body is empty.
 */
const section = (heading: string, body: readonly string[]) => {
  const trimmed = trimBlank(body);

  return trimmed.length === 0 ? [] : [heading, "", ...trimmed, ""];
};

const paragraph = (text: string | undefined) =>
  text === undefined ? [] : [Str.trim(text)];

const fenced = (text: string | undefined) =>
  text === undefined ? [] : ["```", Str.trimEnd(text), "```"];

const link = (target: string) => `[${target}](${target})`;

const overviewLines = (data: MapData) => {
  const { overview } = data;
  const stats = overview.stats ?? [];
  const decisions = overview.decisions ?? [];
  const deepDives = overview.deepDives ?? [];

  const howItsBuilt = [
    ...section(
      "### What the platform provides",
      paragraph(overview.platformProvides)
    ),
    ...section("### What we own", paragraph(overview.weOwn)),
    ...section("### File layout", fenced(overview.fileLayout)),
    ...section("### Cost model", paragraph(overview.costModel)),
    ...section(
      "### Deep dives",
      Arr.map(deepDives, (deepDive) =>
        deepDive.link === undefined
          ? `- **${deepDive.title}.** ${deepDive.summary}`
          : `- **${deepDive.title}.** ${deepDive.summary} See ${link(deepDive.link)}.`
      )
    ),
  ];

  return [
    ...paragraph(overview.summary),
    "",
    ...(stats.length === 0
      ? []
      : [
          ...table(
            ["Stat", "Value"],
            Arr.map(stats, (stat) => [cell(stat.label), cell(stat.value)])
          ),
          "",
        ]),
    ...section(
      "## Decisions",
      decisions.length === 0
        ? []
        : table(
            ["Topic", "Decision", "ADR"],
            Arr.map(decisions, (decision) => [
              cell(decision.topic),
              cell(decision.decision),
              decision.adr === undefined ? "" : cell(link(decision.adr)),
            ])
          )
    ),
    ...(howItsBuilt.length === 0
      ? []
      : ["## How it's built", "", ...howItsBuilt]),
  ];
};

const questionLine = (question: Question, owner: Structure) =>
  question.state === "open"
    ? `- **${question.id}** (${owner.name}) ${question.text}`
    : `- **${question.id}** (${owner.name}) ${question.text} **Answer:** ${question.answer} _(${question.answeredBy}, ${question.answeredOn})_`;

/** Finds the web address `build` worked out for a source, if any. */
type LinkOf = (source: Source) => string | undefined;

const sourceLine = (source: Source, linkOf: LinkOf) => {
  const name = code(normalSourcePath(source.path));
  const url = linkOf(source);
  const shown = url === undefined ? name : `[${name}](${url})`;

  return source.commit === undefined
    ? `- ${shown}`
    : `- ${shown} at ${code(Str.slice(0, 7)(source.commit))}`;
};

const structureLines = (structure: Structure, linkOf: LinkOf) => {
  const steps = structure.steps ?? [];
  const questions = structure.questions ?? [];
  const sources = uniqueSources(structure.sources ?? []);

  return [
    `#### ${structure.code} · ${structure.name}`,
    "",
    `**Status:** ${statusLabels[structure.status]} · **Shape:** ${structure.shape} · **ID:** ${code(structure.id)}`,
    "",
    Str.trim(structure.oneLiner),
    "",
    `**What it does.** ${Str.trim(structure.whatItDoes)}`,
    "",
    `**How it's built.** ${Str.trim(structure.howItsBuilt)}`,
    "",
    ...(sources.length === 0
      ? []
      : [
          "**Sources.**",
          "",
          ...Arr.map(sources, (source) => sourceLine(source, linkOf)),
          "",
        ]),
    ...(steps.length === 0
      ? []
      : [
          "**Steps.**",
          "",
          ...Arr.map(
            steps,
            (step, index) => `${index + 1}. **${step.name}.** ${step.detail}`
          ),
          "",
        ]),
    ...(questions.length === 0
      ? []
      : [
          "**Questions.**",
          "",
          ...Arr.map(questions, (question) =>
            question.state === "open"
              ? `- **${question.id}** ${question.text}`
              : `- **${question.id}** ${question.text} Resolved.`
          ),
          "",
        ]),
  ];
};

const structuresLines = (data: MapData, linkOf: LinkOf) =>
  Arr.flatMap(data.groups, (group) => {
    const members = Arr.filter(
      data.structures,
      (structure) => structure.group === group.id
    );

    return members.length === 0
      ? []
      : [
          `### ${group.title}`,
          "",
          ...Arr.flatMap(members, (member) => structureLines(member, linkOf)),
        ];
  });

const hopRows = (hops: readonly Hop[], nameOf: (id: string) => string) =>
  Arr.map(hops, (hop) => [
    code(hop.id),
    cell(`${nameOf(hop.from)} → ${nameOf(hop.to)}`),
    cell(hop.label),
    payloadCell(hop.payload),
  ]);

/**
 * Renders the map as SYSTEM.md. `source` is the home folder relative to
 * SYSTEM.md, such as `map`. Sections with nothing in them are left out.
 */
export const renderSystemMd: {
  (source: string): (state: MapState) => string;
  (state: MapState, source: string): string;
} = dual(2, (state: MapState, source: string): string => {
  const { data } = state;
  const sourceLinks = state.sourceLinks ?? {};
  const linkOf: LinkOf = (listed) => sourceLinks[sourceKey(listed)];

  const names = new Map(
    Arr.map(data.structures, (structure) => [structure.id, structure.name])
  );

  const nameOf = (id: string) => names.get(id) ?? id;
  const hops = new Map(Arr.map(data.hops, (hop) => [hop.id, hop]));

  const hopsOf = (ids: readonly string[]) =>
    Arr.flatMap(ids, (id) => {
      const hop = hops.get(id);

      return hop === undefined ? [] : [hop];
    });

  const asked = Arr.flatMap(data.structures, (structure) =>
    Arr.map(structure.questions ?? [], (question) => ({ question, structure }))
  );

  const open = Arr.filter(asked, ({ question }) => question.state === "open");

  const resolved = Arr.filter(
    asked,
    ({ question }) => question.state === "resolved"
  );

  const chapters = Arr.map(data.chapters, (chapter, index) => {
    const reveals =
      chapter.reveals.length === 0
        ? ""
        : ` _Reveals: ${Arr.join(Arr.map(chapter.reveals, nameOf), ", ")}._`;

    const plays =
      chapter.plays.length === 0
        ? ""
        : ` _Plays: ${Arr.join(
            Arr.map(hopsOf(chapter.plays), (hop) => hop.label),
            ", "
          )}._`;

    return `${index + 1}. **${chapter.title}.** ${Str.trim(chapter.lede)}${reveals}${plays}`;
  });

  const lines = [
    `# ${data.overview.title}`,
    "",
    `_Generated by \`axonometric build\` from \`${source}/data.mjs\` and \`${source}/layout.json\`. Edit those files and rebuild. Don't edit this file by hand._`,
    "",
    ...(asked.length === 0
      ? []
      : [`_Questions: ${open.length} open, ${resolved.length} resolved._`, ""]),
    ...overviewLines(data),
    ...section("## Walkthrough", chapters),
    ...section(
      "## Structures",
      data.structures.length === 0
        ? []
        : [
            ...table(
              ["ID", "Name", "Code", "Status", "One line"],
              Arr.map(data.structures, (structure) => [
                code(structure.id),
                cell(structure.name),
                structure.code,
                statusLabels[structure.status],
                cell(structure.oneLiner),
              ])
            ),
            "",
            ...structuresLines(data, linkOf),
          ]
    ),
    ...section(
      "## Flows",
      Arr.flatMap(data.flows, (flow, index) => [
        ...(index === 0 ? [] : [""]),
        `### ${flow.name}`,
        "",
        ...table(
          ["ID", "From → To", "Label", "Example payload"],
          hopRows(hopsOf(flow.hops), nameOf)
        ),
      ])
    ),
    ...section(
      "## Hops",
      data.hops.length === 0
        ? []
        : table(
            ["ID", "From → To", "Label", "Example payload"],
            hopRows(data.hops, nameOf)
          )
    ),
    ...section(
      "## Open questions",
      Arr.map(open, ({ question, structure }) =>
        questionLine(question, structure)
      )
    ),
    ...section(
      "## Resolved questions",
      Arr.map(resolved, ({ question, structure }) =>
        questionLine(question, structure)
      )
    ),
  ];

  return `${Str.trimEnd(Arr.join(lines, "\n"))}\n`;
});
