import type { SessionRoomConnection } from '@shared/core/switch-rooms/switch-rooms';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { switchRoomService } from './switch-room-service';

export const switchRoomsController = createRPCController({
  getConnections: (): SessionRoomConnection[] => switchRoomService.getConnections(),
});
