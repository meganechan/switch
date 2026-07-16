import type { GlobalStylesProps } from "@mui/material";

export const GLOBAL_STYLE: GlobalStylesProps["styles"] = {
  ":root": {
    "--nav-drawer-width": "14rem",
    "--nav-closed-drawer-width": "3.25rem",
    "--main-toolbar-height": "4rem",
  },
  "*": {
    scrollbarWidth: "thin",
  },
  ".sticky-toolbar": {
    position: "sticky !important",
    top: 0,
    zIndex: "var(--mui-zIndex-appBar)",
    backgroundColor: "var(--mui-palette-background-default)",
    borderBottom: "1px solid",
    borderBottomColor: "var(--mui-palette-divider)",
    boxSizing: "content-box",
  },
  ".logo-bar": {
    backgroundColor: "var(--mui-palette-background-nav)",
    border: "none",
  },
};
