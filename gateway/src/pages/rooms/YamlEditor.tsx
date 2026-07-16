import { Box } from "@mui/material";
import { yaml } from "@codemirror/lang-yaml";
import CodeMirror from "@uiw/react-codemirror";

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: string;
}

/** CodeMirror-backed YAML editor (dark, syntax-highlit, line numbers, folding).
 *
 * Heavy (pulls in CodeMirror), so consumers should `React.lazy` it — that keeps
 * CodeMirror in a single shared on-demand chunk rather than the main bundle. */
export default function YamlEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  minHeight = "60vh",
}: Props) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        "& .cm-editor": { minHeight },
        "& .cm-editor.cm-focused": { outline: "none" },
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!readOnly}
        readOnly={readOnly}
        extensions={[yaml()]}
        theme="dark"
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          tabSize: 2,
        }}
        style={{ fontSize: "0.85rem" }}
      />
    </Box>
  );
}
