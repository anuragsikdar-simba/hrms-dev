import { useState, useEffect } from 'react';
import { departments as departmentsApi } from '@/lib/api-client';

interface Department {
  id: string;
  name: string;
  employeeCount?: number;
}

/**
 * Loads the department list from the API (cookie-authenticated).
 *
 * Note: this app does not configure a global SWR fetcher, so we use the
 * shared api-client directly instead of useSWR.
 */
export function useDepartments() {
  const [data, setData] = useState<{ departments: Department[] } | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    departmentsApi
      .list()
      .then((res) => {
        if (active) setData({ departments: res.departments ?? [] });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err : new Error('Failed to load departments'));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { data, error, isLoading };
}
