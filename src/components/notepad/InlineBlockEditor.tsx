import type { FocusEvent, KeyboardEvent } from "react";

interface InlineBlockEditorProps {
  value: string;
  placementId: string;
  placeholder?: string;
  onFocus: (placementId: string) => void;
  onChange: (placementId: string, next: string) => void;
  onBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, placementId: string) => void;
}

export function InlineBlockEditor({
  value,
  placementId,
  placeholder,
  onFocus,
  onChange,
  onBlur,
  onKeyDown
}: InlineBlockEditorProps): JSX.Element {
  return (
    <textarea
      className="notepad-editor"
      rows={1}
      data-placement-id={placementId}
      value={value}
      onFocus={() => onFocus(placementId)}
      onChange={(event) => onChange(placementId, event.target.value)}
      onBlur={(event) => onBlur(placementId, event)}
      onKeyDown={(event) => onKeyDown(event, placementId)}
      placeholder={placeholder ?? "Type and press Enter"}
    />
  );
}
