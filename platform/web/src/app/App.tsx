import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { ScrollManager } from './ScrollManager';
import { SeasonProvider } from '../lib/season';
import { AboutPage } from '../pages/AboutPage';
import { AppendixPage } from '../pages/AppendixPage';
import { AppealsPage } from '../pages/AppealsPage';
import { ApplyPage } from '../pages/ApplyPage';
import { CabinetAccessPage } from '../pages/CabinetAccessPage';
import { CabinetDeadlinesPage } from '../pages/CabinetDeadlinesPage';
import { CabinetFinalPage } from '../pages/CabinetFinalPage';
import { CabinetHelpPage } from '../pages/CabinetHelpPage';
import { CabinetMaterialsPage } from '../pages/CabinetMaterialsPage';
import { CabinetPage } from '../pages/CabinetPage';
import { CabinetTeamPage } from '../pages/CabinetTeamPage';
import { CalendarPage } from '../pages/CalendarPage';
import { ContactsPage } from '../pages/ContactsPage';
import { CriteriaPage } from '../pages/CriteriaPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { FaqPage } from '../pages/FaqPage';
import { HistoryPage } from '../pages/HistoryPage';
import { HomePage } from '../pages/HomePage';
import { InitiativePage } from '../pages/InitiativePage';
import { InitiativesPage } from '../pages/InitiativesPage';
import { LegalPage } from '../pages/LegalPage';
import { MasterclassPage } from '../pages/MasterclassPage';
import { MasterclassesPage } from '../pages/MasterclassesPage';
import { MasterclassesPastPage } from '../pages/MasterclassesPastPage';
import { MaterialsPage } from '../pages/MaterialsPage';
import { NewsItemPage } from '../pages/NewsItemPage';
import { NewsPage } from '../pages/NewsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OrganizersPage } from '../pages/OrganizersPage';
import { ParticipantsPage } from '../pages/ParticipantsPage';
import { PartnersPage } from '../pages/PartnersPage';
import { RegulationsPage } from '../pages/RegulationsPage';
import { RequirementsPage } from '../pages/RequirementsPage';
import { StageFinalPage } from '../pages/StageFinalPage';
import { StageFirstPage } from '../pages/StageFirstPage';
import { StageSelectionPage } from '../pages/StageSelectionPage';
import { StagesPage } from '../pages/StagesPage';
import { VideoRequirementsPage } from '../pages/VideoRequirementsPage';
import { WinnersPage } from '../pages/WinnersPage';

// Маршруты публичной части — строго по карте ТЗ 08, п. 2.
//
// Функциональные экраны (/apply и кабинет) идут без общего каркаса сайта: у них
// своя компоновка. Админка собирается отдельным приложением (platform/admin).
// Несуществующий путь отдаёт страницу 404; код ответа 404 обеспечивает
// пререндер при сборке (scripts/prerender.mjs) и конфигурация nginx.

export function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <SeasonProvider>
        <Routes>
          {/* Служебные экраны без шапки сайта */}
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/cabinet/access" element={<CabinetAccessPage />} />
          <Route path="/cabinet" element={<CabinetPage />} />
          <Route path="/cabinet/team" element={<CabinetTeamPage />} />
          <Route path="/cabinet/materials" element={<CabinetMaterialsPage />} />
          <Route path="/cabinet/deadlines" element={<CabinetDeadlinesPage />} />
          <Route path="/cabinet/help" element={<CabinetHelpPage />} />
          <Route path="/cabinet/final" element={<CabinetFinalPage />} />

          {/* Публичная часть в общем каркасе */}
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />

            <Route path="/about" element={<AboutPage />} />
            <Route path="/about/partners" element={<PartnersPage />} />
            <Route path="/about/history" element={<HistoryPage />} />
            <Route path="/about/organizers" element={<OrganizersPage />} />
            <Route path="/about/regulations" element={<RegulationsPage />} />
            <Route path="/about/faq" element={<FaqPage />} />

            <Route path="/stages" element={<StagesPage />} />
            <Route path="/stages/selection" element={<StageSelectionPage />} />
            <Route path="/stages/first" element={<StageFirstPage />} />
            <Route path="/stages/final" element={<StageFinalPage />} />
            <Route path="/stages/calendar" element={<CalendarPage />} />
            <Route path="/stages/criteria" element={<CriteriaPage />} />
            <Route path="/stages/appeals" element={<AppealsPage />} />

            <Route path="/participants" element={<ParticipantsPage />} />
            <Route path="/participants/requirements" element={<RequirementsPage />} />
            <Route path="/participants/materials" element={<MaterialsPage />} />
            <Route path="/participants/video-requirements" element={<VideoRequirementsPage />} />

            <Route path="/initiatives" element={<InitiativesPage />} />
            <Route path="/initiatives/:slug" element={<InitiativePage />} />

            <Route path="/masterclasses" element={<MasterclassesPage />} />
            <Route path="/masterclasses/past" element={<MasterclassesPastPage />} />
            <Route path="/masterclasses/:slug" element={<MasterclassPage />} />

            <Route path="/winners" element={<WinnersPage />} />
            <Route path="/winners/:year" element={<WinnersPage />} />

            <Route path="/news" element={<NewsPage />} />
            <Route path="/news/:slug" element={<NewsItemPage />} />

            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />

            {/* Приложения идут до /legal/:type: иначе «appendix» попадёт в тип. */}
            <Route path="/legal/appendix/:number" element={<AppendixPage />} />
            <Route path="/legal/:type" element={<LegalPage />} />

            <Route path="/404" element={<NotFoundPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </SeasonProvider>
    </BrowserRouter>
  );
}
