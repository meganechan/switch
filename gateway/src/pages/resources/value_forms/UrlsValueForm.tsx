import { Stack, TextField, Typography } from "@mui/material";
import type { ValueFormProps } from "./types";

interface Props extends ValueFormProps {
  helperText: string;
}

/**
 * Shared form for any reference type whose value is `{urls: string[]}`.
 * URLs are entered one per line. Empty lines are ignored.
 */
export default function UrlsValueForm({
  value,
  onChange,
  disabled,
  helperText,
}: Props) {
  const urls = Array.isArray(value.urls) ? (value.urls as string[]) : [];
  const text = urls.join("\n");

  const handleChange = (raw: string) => {
    const next = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onChange({ urls: next });
  };

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {helperText}
      </Typography>
      <TextField
        label="URLs (one per line)"
        multiline
        minRows={4}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        fullWidth
      />
    </Stack>
  );
}
