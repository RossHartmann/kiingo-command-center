import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

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
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeToContent = (): void => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    // Reset first so shrinking works when lines are deleted.
    editor.style.height = "0px";
    editor.style.height = `${Math.max(editor.scrollHeight, 24)}px`;
  };

  useLayoutEffect(() => {
    resizeToContent();
  }, [value]);

  return (
    <textarea
      ref={editorRef}
      className="notepad-editor"
      rows={1}
      wrap="soft"
      data-placement-id={placementId}
      value={value}
      onFocus={() => {
        resizeToContent();
        onFocus(placementId);
      }}
      onChange={(event) => {
        resizeToContent();
        onChange(placementId, event.target.value);
      }}
      onBlur={(event) => onBlur(placementId, event)}
      onKeyDown={(event) => onKeyDown(event, placementId)}
      placeholder={placeholder ?? "Type and press Enter"}
    />
  );
}
