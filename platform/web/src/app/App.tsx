import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApplyPage } from '../pages/ApplyPage';
import { CabinetAccessPage } from '../pages/CabinetAccessPage';
import { CabinetPage } from '../pages/CabinetPage';
import { NotFoundPage } from '../pages/NotFoundPage';

// Маршруты функциональных экранов публичной сборки. Маркетинговые страницы
// (главная, «О конкурсе», этапы, архив, победители, документы) появятся
// отдельным этапом после утверждения дизайна (ТЗ 08, п. 9.2).
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/apply" replace />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/cabinet/access" element={<CabinetAccessPage />} />
        <Route path="/cabinet" element={<CabinetPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
