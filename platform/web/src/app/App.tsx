import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AboutPage } from '../pages/AboutPage';
import { ApplyPage } from '../pages/ApplyPage';
import { CabinetAccessPage } from '../pages/CabinetAccessPage';
import { CabinetPage } from '../pages/CabinetPage';
import { ContactsPage } from '../pages/ContactsPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { HomePage } from '../pages/HomePage';
import { InitiativePage } from '../pages/InitiativePage';
import { InitiativesPage } from '../pages/InitiativesPage';
import { LegalPage } from '../pages/LegalPage';
import { MasterclassesPage } from '../pages/MasterclassesPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ParticipantsPage } from '../pages/ParticipantsPage';
import { StagesPage } from '../pages/StagesPage';
import { WinnersPage } from '../pages/WinnersPage';

// Маршруты публичной части (ТЗ 08, п. 2). Функциональные экраны — /apply и
// /cabinet — идут без общего каркаса: у мастера и кабинета своя компоновка.
// Несуществующий путь отдаёт честную страницу 404, а не главную.

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Служебные экраны без шапки сайта */}
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/cabinet/access" element={<CabinetAccessPage />} />
        <Route path="/cabinet" element={<CabinetPage />} />

        {/* Публичная часть в общем каркасе */}
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/about/regulations" element={<DocumentsPage />} />
          <Route path="/about/faq" element={<AboutPage />} />
          <Route path="/stages" element={<StagesPage />} />
          <Route path="/stages/calendar" element={<StagesPage />} />
          <Route path="/stages/criteria" element={<StagesPage />} />
          <Route path="/participants" element={<ParticipantsPage />} />
          <Route path="/participants/requirements" element={<ParticipantsPage />} />
          <Route path="/participants/materials" element={<ParticipantsPage />} />
          <Route path="/initiatives" element={<InitiativesPage />} />
          <Route path="/initiatives/:slug" element={<InitiativePage />} />
          <Route path="/masterclasses" element={<MasterclassesPage />} />
          <Route path="/winners" element={<WinnersPage />} />
          <Route path="/winners/:year" element={<WinnersPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/legal/:type" element={<LegalPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
