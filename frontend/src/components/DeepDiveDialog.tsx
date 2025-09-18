import { useMemo } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useQuery } from '@tanstack/react-query';
import { ApiClient, NewsItem, RelatedContentResponse } from '../api/client';

interface DeepDiveDialogProps {
  open: boolean;
  onClose: () => void;
  section: string;
  period: string;
  item?: NewsItem;
}

function RelatedTree({ item, depth = 1 }: { item: RelatedContentResponse['item']; depth?: number }) {
  if (!item.related || item.related.length === 0) {
    return null;
  }
  return (
    <Stack spacing={1} mt={1} sx={{ borderLeft: (theme) => `2px solid ${theme.palette.divider}`, pl: 2 }}>
      {item.related.map((child) => (
        <Accordion key={child.id} disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" fontWeight={600}>
              {child.title}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" color="text.secondary">
              {child.summary}
            </Typography>
            {child.related && depth < 5 && <RelatedTree item={child} depth={depth + 1} />}
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}

export function DeepDiveDialog({ open, onClose, section, period, item }: DeepDiveDialogProps) {
  const query = useQuery({
    enabled: open && Boolean(item?.id),
    queryKey: ['related', section, period, item?.id],
    queryFn: () => ApiClient.related(section, period, item!.id, 5),
    staleTime: 1000 * 60 * 15,
  });

  const relatedItem = useMemo(() => query.data?.item ?? null, [query.data?.item]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Deep Dive Context</DialogTitle>
      <DialogContent dividers>
        {query.isLoading && (
          <Stack alignItems="center" py={4}>
            <CircularProgress />
          </Stack>
        )}
        {relatedItem && (
          <Stack spacing={2}>
            <Typography variant="h6" fontWeight={600}>
              {relatedItem.title}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {relatedItem.summary}
            </Typography>
            {relatedItem.related && relatedItem.related.length > 0 ? (
              <RelatedTree item={relatedItem} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Additional related coverage will appear here once available.
              </Typography>
            )}
          </Stack>
        )}
        {query.isError && (
          <Typography variant="body2" color="error">
            Unable to load related insights. Please try again later.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
