import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/src/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'especialista', name: 'Ana', project_ids: ['p1'] } }),
}));
jest.mock('@/src/api', () => ({
  api: {
    listChannels: jest.fn(),
    listChannelMessages: jest.fn(),
    sendChannelMessage: jest.fn(),
  },
}));

import { api } from '@/src/api';
import { MensajesView } from '@/app/(spec)/mensajes';

const listChannels = api.listChannels as jest.Mock;
const listMessages = api.listChannelMessages as jest.Mock;
const sendMessage = api.sendChannelMessage as jest.Mock;
const originalOS = Platform.OS;

jest.setTimeout(30000);

async function abrirChat() {
  render(<MensajesView projectId="p1" />);
  fireEvent.press(await screen.findByText('# General'));
  return screen.findByPlaceholderText('Escribe un mensaje_');
}

function teclear(campo: any, nativeEvent: Record<string, unknown>) {
  const preventDefault = jest.fn();
  fireEvent(campo, 'keyPress', { nativeEvent, preventDefault });
  return preventDefault;
}

beforeEach(() => {
  jest.clearAllMocks();
  listChannels.mockResolvedValue([{ id: 'c1', project_id: 'p1', type: 'general', name: 'General' }]);
  listMessages.mockResolvedValue([]);
  sendMessage.mockImplementation(async (_cid: string, text: string) => ({
    id: 'm1', channel_id: 'c1', user_id: 'u1', user_name: 'Ana', text, created_at: '2026-09-24T12:00:00Z',
  }));
});

afterEach(() => {
  (Platform as any).OS = originalOS;
});

describe('Mensajes: Enter en el campo (G-06)', () => {
  it('en web, Enter envía el mensaje y evita el salto de línea', async () => {
    (Platform as any).OS = 'web';
    const campo = await abrirChat();
    fireEvent.changeText(campo, 'Hola equipo');
    const evitar = teclear(campo, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('c1', 'Hola equipo'));
    expect(evitar).toHaveBeenCalled();
  });

  it('en web, Mayús+Enter no envía ni cancela el salto de línea', async () => {
    (Platform as any).OS = 'web';
    const campo = await abrirChat();
    fireEvent.changeText(campo, 'Línea uno');
    const evitar = teclear(campo, { key: 'Enter', shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(evitar).not.toHaveBeenCalled();
  });

  it('en web, Enter con el mensaje vacío no envía', async () => {
    (Platform as any).OS = 'web';
    const campo = await abrirChat();
    const evitar = teclear(campo, { key: 'Enter', shiftKey: false });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(evitar).toHaveBeenCalled(); // tampoco mete un salto de línea vacío
  });

  it('en móvil el campo no intercepta el teclado (Enter = salto de línea)', async () => {
    (Platform as any).OS = 'android';
    const campo = await abrirChat();
    expect(campo.props.onKeyPress).toBeUndefined();
  });
});
