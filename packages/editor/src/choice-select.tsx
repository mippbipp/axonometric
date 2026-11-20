import { Field, FieldLabel } from "@axonometric/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@axonometric/ui/components/select";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

/**
 * A labelled pick of one choice from a list, on ui-sdk's Select. The label
 * names the trigger for screen readers, and `hideLabel` keeps it for them
 * alone. `onChange` only hears a choice, never the `null` ui-sdk reports for
 * nothing chosen. `value` outside the list, such as "", shows `placeholder`.
 * `trigger` carries the page's `data-*` hooks onto the button that opens the
 * list.
 */
export function ChoiceSelect({
  choices,
  className,
  disabled = false,
  hideLabel = false,
  label,
  onChange,
  placeholder,
  trigger,
  value,
}: {
  readonly choices: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly hideLabel?: boolean;
  readonly label: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly trigger?: Readonly<Record<`data-${string}`, string>>;
  readonly value: string;
}) {
  const chosen = Arr.some(choices, (choice) => choice.value === value);

  return (
    <Field className={className} disabled={disabled}>
      <FieldLabel className={cn(hideLabel ? "sr-only" : "opacity-70")}>
        {label}
      </FieldLabel>
      <Select
        items={Arr.map(choices, ({ label: text, value: id }) => ({
          label: text,
          value: id,
        }))}
        onValueChange={(next) => {
          if (typeof next === "string") {
            onChange(next);
          }
        }}
        value={chosen ? value : null}
      >
        <SelectTrigger
          className="w-full"
          placeholder={placeholder}
          {...trigger}
        />
        <SelectContent>
          {Arr.map(choices, (choice) => (
            <SelectItem
              data-choice={choice.value}
              key={choice.value}
              label={choice.label}
              value={choice.value}
            >
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
