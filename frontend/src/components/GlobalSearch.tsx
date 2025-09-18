import { useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useQuery } from '@tanstack/react-query';
import { ApiClient } from '../api/client';

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const searchQuery = useQuery({
    queryKey: ['search', query],
    enabled: query.trim().length > 2,
    queryFn: () => ApiClient.search(query.trim()),
    staleTime: 1000 * 60,
  });

  const results = useMemo(() => searchQuery.data?.results ?? [], [searchQuery.data?.results]);

  return (
    <Box sx={{ position: 'relative', width: { xs: '100%', md: 360 } }}>
      <TextField
        size="small"
        fullWidth
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        placeholder="Search AI, ML, IoT, Quantum…"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: query ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setQuery('')}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 200);
        }}
        onFocus={() => {
          if (query.length > 0) {
            setOpen(true);
          }
        }}
      />
      {open && query.length > 0 && (
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            top: '110%',
            left: 0,
            right: 0,
            zIndex: (theme) => theme.zIndex.modal,
            maxHeight: 360,
            overflow: 'auto',
          }}
        >
          {searchQuery.isLoading && (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={18} />
            </Box>
          )}
          {!searchQuery.isLoading && results.length === 0 && (
            <Box px={2} py={1}>
              No results yet. Try refining your query.
            </Box>
          )}
          <List dense>
            {results.map((item) => (
              <ListItemButton
                key={item.id}
                component="a"
                href={item.url ?? '#'}
                target={item.url ? '_blank' : undefined}
                rel="noopener noreferrer"
              >
                <ListItemText
                  primary={item.headline}
                  secondary={`${item.summary.substring(0, 120)}${item.summary.length > 120 ? '…' : ''}`}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
