import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type SeasonResponse } from '@shared/index';

// Активный сезон и настройки сайта (ТЗ 02, п. 2: даты не хранятся в коде).
//
// Данные запрашиваются один раз на всё приложение: от них зависят шапка
// («Приём заявок завершён» вместо кнопки), календарь, дедлайны кабинета и
// подвал. Ошибка запроса не должна ломать страницу: интерфейс показывает
// состояние «данные недоступны» и продолжает работать.

interface SeasonState {
  data: SeasonResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const SeasonContext = createContext<SeasonState>({
  data: null,
  loading: true,
  error: null,
  reload: () => undefined,
});

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SeasonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const response = await api.season();
        if (!active) return;
        setData(response);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Не удалось получить данные сезона');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [nonce]);

  return (
    <SeasonContext.Provider value={{ data, loading, error, reload: () => setNonce((value) => value + 1) }}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason(): SeasonState {
  return useContext(SeasonContext);
}
