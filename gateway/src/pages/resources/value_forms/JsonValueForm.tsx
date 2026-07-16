import { Alert, Stack, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import type { ValueFormProps } from "./types";

/**
 * Fallback editor for reference types that have no dedicated form component
 * registered. Accepts raw JSON and parses on every keystroke.
 */
export default function JsonValueForm({ value, onChange, disabled }: ValueFormProps) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    // Only refresh from prop when the editor isn't actively being typed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (raw: string) => {
    setText(raw);
    try {
      const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
      onChange(parsed as Record<string, unknown>);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <Stack spacing={1}>
      <TextField
        label="Value (JSON)"
        multiline
        minRows={6}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        fullWidth
        slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
      />
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
