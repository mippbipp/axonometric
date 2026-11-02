import { pipe, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import { ProvisionalId } from "./structure-change.ts";
import { idText, oneLineText } from "./text-schemas.ts";

/** The most characters a group title holds. */
export const maxGroupTitleLength = 80;

/** A group's title: one line, trimmed, not longer than the limit. */
export const GroupTitle = oneLineText({
  what: "title",
  max: maxGroupTitleLength,
});

/** The id of a group data.mjs has. data.mjs sets no pattern, so only line breaks are refused. */
export const GroupId = idText("group");

/** What the engineer sets when proposing a group. */
export const NewGroup = Schema.Struct({
  id: ProvisionalId,
  title: GroupTitle,
}).annotate(objectMessages("A new group has only id and title."));

export type NewGroup = typeof NewGroup.Type;

/**
 * A proposed change to the groups. An `add` carries a provisional id and a
 * title; the structures that go into the group are separate structure items
 * that change their group to it. A `rename` names a group that data.mjs has.
 */
export const GroupChange = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("add"),
    group: NewGroup,
  }).annotate(objectMessages("An add has only action and group.")),
  Schema.Struct({
    action: Schema.Literal("rename"),
    group: GroupId,
    title: GroupTitle,
  }).annotate(objectMessages("A rename has only action, group and title.")),
]).annotate({
  message:
    'expected a group change: { action: "add", group: { id, title } } or { action: "rename", group, title }.',
});

export type GroupChange = typeof GroupChange.Type;

/** The id of the group a change acts on: the provisional id for an add. */
export const groupOf = (change: GroupChange): string =>
  change.action === "add" ? change.group.id : change.group;

/** The title a change gives its group. */
export const titleOf = (change: GroupChange): string =>
  change.action === "add" ? change.group.title : change.title;

/** Whether two changes act on the same group in the same way. */
export const sameGroupSubject: {
  (b: GroupChange): (a: GroupChange) => boolean;
  (a: GroupChange, b: GroupChange): boolean;
} = dual(
  2,
  (a: GroupChange, b: GroupChange): boolean =>
    a.action === b.action && groupOf(a) === groupOf(b)
);

/**
 * A provisional id for a group called `title`: its words as a slug, then
 * `suffix`, such as `data-layer-4f2a`. The agent can use it as the group's id
 * as it stands.
 */
export const provisionalGroupIdOf: {
  (suffix: string): (title: string) => string;
  (title: string, suffix: string): string;
} = dual(2, (title: string, suffix: string): string => {
  const slug = pipe(
    Str.toLowerCase(title),
    Str.replaceAll(/[^a-z0-9]+/gu, "-"),
    Str.replaceAll(/^-+|-+$/gu, ""),
    Str.slice(0, 40),
    Str.replaceAll(/-+$/gu, "")
  );

  return `${slug === "" ? "group" : slug}-${suffix}`;
});
