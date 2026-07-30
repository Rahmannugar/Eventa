import { AppRoutes } from './routes/AppRoutes';
import { AppToaster } from './components/ui/AppToaster';

export function App() {
  return (
    <>
      <AppRoutes />
      <AppToaster />
    </>
  );
}
