// Placeholder for driving a physical robot hand from the browser's retargeted
// commands. The browser sends {type: 'robot', side, inspire: number[6]} at ~30 Hz
// when "Mirror to physical robot" is enabled.
//
// TODO(hardware): hook in the Aalto Robotics Club Inspire hand integration here
// (likely serial/Modbus or a ROS topic). Inspire angle convention assumed:
// 0..1000 with 1000 = fully open, order [little, ring, middle, index, thumbBend, thumbRotate].
// Verify against their code before connecting hardware.

export function createRobotOutput({ log = console.log } = {}) {
  let last = 0;
  let count = 0;
  return {
    send(msg) {
      count++;
      const now = Date.now();
      if (now - last > 2000) {
        log(`[robot] ${count} commands in last ${((now - last) / 1000).toFixed(1)}s, latest ${msg.side}: [${msg.inspire.join(', ')}] (no hardware attached)`);
        last = now;
        count = 0;
      }
    },
  };
}
