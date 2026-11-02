import { pipe, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import { ProvisionalId } from "./structure-change.ts";

/** The most characters a group title holds. */
export const maxGroupTitleLength = 80;

const titleFix = `expected a title of 1 to ${maxGroupTitleLength} characters on one line, with no space at either end.`;

/** A group's title: one line, trimmed, not longer than the limit. */
export const GroupTitle = Schema.String.annotate({ message: titleFix }).check(
  Schema.isPattern(/^\S(?:[^\r\n\u0085\u2028\u2029]*\S)?$/u, {
    message: titleFix,
  }),
  Schema.isMaxLength(maxGroupTitleLength, { message: titleFix })
);

const groupFix = "expected the id of one of the map's groups, on one line.";

/** The id of a group data.mjs has. data.mjs sets no pattern, so only line breaks are refused. */
export const GroupId = Schema.String.annotate({ message: groupFix }).check(
  Schema.isNonEmpty({ message: groupFix }),
  Schema.isMaxLength(200, { message: groupFix }),
  Schema.isPattern(/^[^\r\n\u0085\u2028\u2029]+$/u, { message: groupFix })
);

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

/**
 * The key a new group's rename is stored under in the commit's map of renames,
 * which structures share. It keeps a group's id apart from a structure's.
 */
export const groupKey = (id: string): string => `group:${id}`;

/** The id of the group a change acts on: the provisional id for an add. */
export const groupOf = (change: GroupChange): string =>
  change.action === "add" ? change.group.id : change.group;

/** The title a change gives its group. */
export const titleOf = (change: GroupChange): string =>
  change.action === "add" ? change.group.title : change.title;

const equivalent = Schema.toEquivalence(GroupChange);

export const sameGroupChange: {
  (b: GroupChange): (a: GroupChange) => boolean;
  (a: GroupChange, b: GroupChange): boolean;
} = dual(2, (a: GroupChange, b: GroupChange): boolean => equivalent(a, b));

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
