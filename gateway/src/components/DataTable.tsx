import {
  DataGridPro,
  type GridColDef,
  type GridRowId,
  type GridRowParams,
} from "@mui/x-data-grid-pro";
import { Box, type SxProps, type Theme } from "@mui/material";

interface DataTableProps<T extends { id: string | number }> {
  rows: T[];
  columns: GridColDef<T>[];
  height?: number;
  // When true, the table grows to fill its (flex-column) parent instead of
  // using a fixed `height`. The parent must be a flex column with a bounded
  // height (e.g. a page laid out with flexGrow + minHeight: 0).
  fillHeight?: boolean;
  pageSize?: number;
  checkboxSelection?: boolean;
  onRowSelectionModelChange?: (ids: GridRowId[]) => void;
  onRowClick?: (params: GridRowParams<T>) => void;
  sx?: SxProps<Theme>;
}

export default function DataTable<T extends { id: string | number }>({
  rows,
  columns,
  height = 600,
  fillHeight = false,
  pageSize = 25,
  checkboxSelection = false,
  onRowSelectionModelChange,
  onRowClick,
  sx,
}: DataTableProps<T>) {
  const extraSx = Array.isArray(sx) ? sx : sx ? [sx] : [];
  const grid = (
    <DataGridPro
      rows={rows}
      columns={columns}
      initialState={{
        pagination: { paginationModel: { pageSize } },
      }}
      pageSizeOptions={[10, 25, 50]}
      pagination
      checkboxSelection={checkboxSelection}
      onRowSelectionModelChange={
        onRowSelectionModelChange
          ? (model) => onRowSelectionModelChange([...model.ids])
          : undefined
      }
      onRowClick={onRowClick}
      disableRowSelectionOnClick
      sx={[
        {
          border: "none",
          height: fillHeight ? "100%" : height,
          "& .MuiDataGrid-cell": { minHeight: 48 },
        },
        ...extraSx,
      ]}
    />
  );

  if (!fillHeight) return grid;

  // Fill the remaining vertical space of a flex-column parent.
  return <Box sx={{ flex: 1, minHeight: 0, width: "100%" }}>{grid}</Box>;
}
