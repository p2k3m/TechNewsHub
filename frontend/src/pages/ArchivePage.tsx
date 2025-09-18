import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Chip,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ApiClient } from '../api/client';

export function ArchivePage() {
  const params = useParams();
  const sectionId = params.sectionId ?? 'ai';
  const period = params.period ?? 'monthly';
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['archive', sectionId, period],
    queryFn: () => ApiClient.fetchNews(sectionId, period),
    staleTime: 1000 * 60 * 10,
  });

  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    if (!search) {
      return items;
    }
    const lowered = search.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(lowered) ||
        item.summary.toLowerCase().includes(lowered),
    );
  }, [query.data?.items, search]);

  return (
    <Stack spacing={3}>
      <Breadcrumbs>
        <Link underline="hover" color="inherit" href="/">
          Home
        </Link>
        <Link underline="hover" color="inherit" href={`/section/${sectionId}`}>
          {sectionId.toUpperCase()}
        </Link>
        <Typography color="text.primary">{period.toUpperCase()} Archive</Typography>
      </Breadcrumbs>

      <Typography variant="h4" fontWeight={700} textTransform="capitalize">
        {sectionId.replace('-', ' ')} archive ({period})
      </Typography>

      <TextField
        fullWidth
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        label="Search within archive"
        placeholder="e.g. AI ethics breakthroughs"
      />

      {query.isLoading && <LinearProgress />}

      <Stack spacing={2}>
        {filtered.map((item) => (
          <Box key={item.id} sx={{ p: 3, borderRadius: 3, bgcolor: 'background.paper', boxShadow: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography variant="h6" fontWeight={600}>
                {item.title}
              </Typography>
              <Chip label={`${item.verificationScore}%`} color="success" size="small" />
            </Stack>
            <Typography variant="body2" color="text.secondary" mt={1}>
              {item.summary}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              {dayjs(item.publishedAt ?? query.data?.generatedAt).format('MMMM D, YYYY h:mm A')}
            </Typography>
          </Box>
        ))}
        {filtered.length === 0 && !query.isLoading && (
          <Typography variant="body2" color="text.secondary">
            No archive entries match your search yet. Try another keyword or adjust the time horizon.
          </Typography>
        )}
        {query.isError && (
          <Typography variant="body2" color="error">
            Unable to load archive data. Please try again later.
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
