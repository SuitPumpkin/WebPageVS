import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { StudentPage } from './pages/StudentPage';

function AdminRoute({ onBack }: { onBack: () => void }) {
  const params = useParams();
  const roomCode = params.roomCode || '';
  return <AdminPage roomCode={roomCode} onBack={onBack} />;
}

function StudentRoute() {
  const params = useParams();
  return <StudentPage roomCode={params.roomCode || ''} />;
}

function AppRoutes() {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    navigate('/');
  };

  return (
    <Routes>
      <Route path="/student/:roomCode" element={<StudentRoute />} />
      <Route path="/" element={isLoggedIn ? <AdminPage roomCode="" onBack={handleLogout} /> : <LoginPage onLogin={handleLogin} />} />
      <Route path="/admin/:roomCode" element={isLoggedIn ? <AdminRoute onBack={handleLogout} /> : <LoginPage onLogin={handleLogin} />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}