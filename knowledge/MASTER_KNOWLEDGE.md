# MASTER_KNOWLEDGE

Last consolidated: 2026-08-12

This file is a portable technical handoff extracted from long-running ChatGPT conversations. It is intended for future AI agents, collaborators, and the user himself. Treat it as historical context, not as a substitute for current source code or live hardware measurements.

## 1. User / working style

- Preferred name: Teddy.
- Main domain: aerospace, robotics, control, reinforcement learning, embedded systems, EtherCAT, ROS2.
- Prefers concrete terminal commands, code-level debugging, step-by-step explanations, and explanations tied to the actual project rather than generic theory.
- Often works iteratively: first make one subsystem run, then increase complexity.
- Important rule for future agents: do not silently merge historical parameter sets. When two values conflict, identify which project/version they came from and verify against current code/hardware.

## 2. Main long-term project: wheel-legged robot

### 2.1 Hardware

- Four DM-J4310 joint motors using MIT-style control.
- Two DM-H3510 wheel-hub motors.
- Two wheel/hub assemblies roughly 125-130 g each.
- Robot total mass around 2.8 kg in one recorded configuration.
- Wheel diameter about 60 mm in a commonly used configuration.
- Example component masses recorded during mechanical modeling:
  - big arm: ~30 g x4
  - small leg component: ~25 g x2
  - big leg component: ~30 g x2
  - wheel hub assemblies: ~130 g x2
- Historical wheel-center targets include `(35,100) mm` and later `(35,55) mm`. These refer to different design iterations; do not assume they are interchangeable.

### 2.2 Five-bar leg geometry / kinematics

The robot uses a planar five-bar leg model with points O and D and lengths L1..L5. Main functions used historically:

- `fivebar_fk`
- `fivebar_ik`
- `Motor_Position_To_Joint`

Control mapping concept:

- Foot Cartesian force: `F = [Fx, Fy]^T`
- Joint torque: `tau = J^T F`

Historical geometry values used in one merged VMC project were approximately:

- L1 = 0.0804 m
- L2 = 0.1200 m
- L3 = 0.1200 m
- L4 = 0.0804 m
- L5 = 0.0700 m

Treat these as one specific implementation snapshot, not universal truth. Verify against the active MATLAB/Simulink/C++ source before reuse.

Calibration-related variables encountered:

- `qm0`
- `qj0`
- `motor_ratio`
- `motor_sign`

Future agents must preserve left/right leg coordinate conventions. Sign errors in Jacobian, motor direction, pitch direction, or wheel torque can produce behavior that looks like controller instability.

### 2.3 Control architecture

Long-running target architecture:

1. VMC controls leg endpoint forces / body height.
2. Five-bar Jacobian maps endpoint force to joint motor torque.
3. Wheel controller stabilizes body pitch / drives longitudinal motion.
4. MIT motor mode is often used as torque control with `kp=0`, `kd=0`, torque passed as feed-forward.

Important explored controllers:

- Cascaded PID for inverted-pendulum balancing.
- LQR as a replacement for heuristic PID.
- VMC for height and body support.
- Gravity feed-forward.
- Later goal: merge VMC and a compact/micro LQR into one ROS2 control node.

Example VMC feed-forward concept used in MuJoCo:

- `Fx_ff = -0.5 * m * g * sin(pitch)`
- `Fy_ff =  0.5 * m * g * cos(pitch)`

These equations were used as a starting point and must be reconciled with coordinate conventions.

### 2.4 Recorded control symptoms / lessons

Observed during real/simulated tests:

- Robot could show a divergent sinusoidal forward/backward motion.
- Startup oscillation / shaking around pitch=0.
- Some tests showed little or no corrective action when robot was laid down.
- At times angular-rate response looked slow while angle response was aggressive.
- Static height error around 7-11 mm was seen with one VMC gain set (`kp≈3.3`).
- Very small torque quantization/step around `0.00186` was observed in one chain.
- `L_Fy1/R_Fy2 < 0.02` was noted in one debug context.
- Historical coefficients `Alpha≈0.0548`, `Beta≈-0.0508` appeared in one controller implementation.

General lessons derived from debugging:

- Always verify radians vs degrees.
- For derivative feedback, use gyro/angular velocity when possible rather than noisy finite differences of angle.
- Test control direction with tiny limited torque before increasing gains.
- Static friction can create apparent dead-zone then overshoot; feed-forward friction compensation may be useful.
- Do not tune height loop and balance loop simultaneously at first.

## 3. ROS2 / Simulink / EtherCAT stack

### 3.1 Core software

- Ubuntu 22.04 is the main Linux environment for robot control.
- ROS2 Humble.
- MATLAB/Simulink R2023b.
- ERT C++ code generation used in several models.
- SOEM EtherCAT master.

Historical Simulink model names include:

- `mock`
- `foot`
- `testing_DM_hby`
- `VMC_test`

Typical issues encountered:

- Bus Creator element count/name mismatch.
- virtual vs non-virtual bus mismatch.
- `single` / `double` datatype mismatch.
- Stateflow/code-generation optimization warnings.
- sample-time representation warnings around 333.3333 Hz.
- uninitialized safety limit variables such as `TorqueSafetyLimit`.

### 3.2 ROS2 custom messages / topics

Custom message concepts used:

- `ReadDJIRC`
- `WriteDmMotorMITControl`

MIT command fields recorded:

- `enable`
- `p_des`
- `v_des`
- `kp`
- `kd`
- `torque`

Representative EtherCAT ROS2 topic pattern:

- `/ecat/<sn>/app1/read`
- `/ecat/<sn>/app2/read`
- `/ecat/<sn>/app3/write`
- `/latency`

One historical slave mapping example:

- app1: motors
- app2: IMU
- app3: DSHOT

This mapping is firmware/config-dependent. Do not assume it for a newly flashed slave.

### 3.3 Frequencies

Recorded target/observed frequencies across iterations:

- Simulink control originally ~100 Hz.
- Later target ~333.33 Hz.
- IMU commonly ~333 Hz, later interest in 500 Hz.
- SOEM loop observed around ~2.75 kHz in one configuration.

A Hipnuc firmware discussion suggested changing a `delay` in `Core/Src/main.c` from a value corresponding to lower rate to `2` for approximately 500 Hz. Future agent must inspect current repository implementation before confirming.

### 3.4 Workspaces / build history

Important working directory names seen in history:

- `~/foot_ws`
- `~/ZLT`
- Windows Isaac workspace: `E:\IsaacWork\IsaacLab`

A typical ROS2 build succeeded with packages:

- `custom_msgs`
- `soem`
- `soem_bringup`
- `soem_wrapper`

At one point a workspace build contained stale references to another install path in `COLCON_PREFIX_PATH`, `AMENT_PREFIX_PATH`, and `CMAKE_PREFIX_PATH`; cleaning environment/build/install/log solved or reduced these issues.

Useful clean rebuild pattern:

```bash
cd <workspace>
rm -rf build install log
source /opt/ros/humble/setup.bash
colcon build
source install/setup.bash
```

## 4. EtherCAT slave / firmware work

### 4.1 Hardware

- AX58100 EtherCAT controller + STM32H750-based universal module.
- AIMEtherCAT repositories are heavily used, especially `EcatV2_Master`.

One historical slave description:

- name similar to `58100_H750_UniversalModule`
- DC capable.

### 4.2 Common failure states

A notable `slaveinfo` failure state:

- 1 slave detected.
- calculated workcounter = 0.
- slave remained in INIT.
- input/output size = 0 bits.
- safe operational state not reached.

Interpretation used during debugging:

- physical detection alone does not mean PDO/configuration is valid.
- EEPROM identity/configuration, firmware, PDO mapping, and application initialization all matter.
- SN=0 / firmware=0 often indicates identity/application data was not correctly available rather than proving the whole board is electrically dead.

### 4.3 ST-LINK / OpenOCD flashing

Hardware used:

- ST-LINK V2/V2.1 variants.
- STM32H750 target.

Typical OpenOCD files:

- `interface/stlink.cfg`
- `target/stm32h7x.cfg`

Representative reliable-style command pattern used in debugging:

```bash
sudo openocd \
  -f interface/stlink.cfg \
  -c "transport select hla_swd" \
  -f target/stm32h7x.cfg \
  -c "adapter speed 50" \
  -c "reset_config none" \
  -c "init" \
  -c "halt" \
  -c "adapter speed 1000" \
  -c "flash probe 0" \
  -c "flash write_image erase \"<ELF_FILE>\"" \
  -c "verify_image \"<ELF_FILE>\"" \
  -c "reset run" \
  -c "shutdown"
```

Failures encountered:

- timeout waiting for target halted.
- target not halted.
- large verify/program error counts.

Debugging principles:

- start SWD at low adapter speed.
- verify target voltage.
- if reset/halt is unreliable, try `reset_config none` / manual halt sequence.
- confirm exact STM32 target config.
- do not assume an ELF-to-BIN conversion fixes a communication problem.

ELF-to-BIN pattern used:

```bash
arm-none-eabi-objcopy \
  -O binary \
  --gap-fill 0xFF \
  input.elf output_flash.bin
```

## 5. Hipnuc IMU / CAN / FDCAN

Repository frequently used:

- `AIMEtherCAT/hipnucimu`

Hardware / topics explored:

- multiple IMUs connected through CAN/FDCAN.
- G431/G341 transfer boards.
- one board variant lacked UART, requiring alternate communication path for PC configuration.
- IMU IDs were changed for multi-device operation.

Important historical symptom:

- after swapping IDs, one app channel failed while another was normal.

Key debugging ideas:

- unique CAN IDs are mandatory for multiple devices on the same bus.
- verify CAN-H/CAN-L polarity and termination.
- UART TX/RX cross-connect when using a USB-UART adapter.
- configuration should be saved to nonvolatile storage and device rebooted after changing persistent settings.
- changing ID in the PC application and changing firmware-side routing/mapping are separate concerns.

IMU convention recorded in one robot integration:

- pitch forward was treated as positive.

Always re-check the actual sensor frame and ROS frame transform before controller tuning.

## 6. MuJoCo work

Used on Ubuntu and Windows.

Model filenames historically included:

- `fixed_leg_wheelbot.xml`
- `real_mesh_dynamic_template_v2.xml`
- `simplified_120mm_wheelbot.xml`
- `car.xml`

One simplified balance controller configuration recorded:

- `INITIAL_PITCH_DEG = 30`
- `Kp_wheel = 0.08`
- `Kp_pitch = 1.52`
- `Kd_pitch = 1.2`
- `torque_limit = 0.8`
- `OUTPUT_SIGN = -1`
- `DEADZONE = ±0.01`

A PX4-inspired cascade was also explored:

- `MAX_PITCH_SP = 0.20944 rad`
- attitude-loop P ≈ 8.0
- rate-loop P ≈ 0.1
- rate-loop D ≈ 0.005
- torque limit ≈ 0.8

These are historical tuning snapshots only.

## 7. Isaac Lab / reinforcement learning

### 7.1 Environment

Primary Windows setup:

- Isaac Lab workspace: `E:\IsaacWork\IsaacLab`
- Isaac Lab version around 2.3.2 in the recorded learning phase.
- Isaac Sim around 5.1.0.0.
- dedicated Python under `E:\IsaacWork\env_isaaclab\python.exe`
- Python 3.11.15 in that environment.

Important lesson:

Running tutorial scripts with generic `python` invoked the wrong interpreter and caused `ModuleNotFoundError: isaaclab`. Use the Isaac Lab launcher/environment, e.g. `isaaclab.bat` or the dedicated Python.

Tutorials covered:

- launch app / empty stage
- spawn prims
- rigid objects
- articulations
- deformable objects
- surface gripper
- InteractiveScene
- parallel environments

### 7.2 RL learning direction

Central questions explored:

- What matters most: policy architecture vs reward design?
- How to structure curriculum learning?
- Can a biped first learn standing, then walking?
- How to judge whether training is improving rather than just running longer?

Preferred future route:

1. Start from a minimal task.
2. Learn stable standing / posture first.
3. Add velocity tracking.
4. Add disturbances / robustness.
5. Add harder terrain / dynamic behaviors.

Important conceptual guidance:

- reward/observation/action design and task formulation often dominate early success more than exotic network architecture.
- parallel environments provide many simultaneous samples; increasing `num_envs` is not equivalent to simply training longer.
- curriculum is strongly preferred for a difficult humanoid/biped task.

## 8. LQR / MPC / classical control study

The user is actively learning classical and modern control alongside RL.

Topics discussed:

- inverted pendulum state-space models.
- LQR gain derivation and required physical parameters.
- MPC as an optimization-based, model-driven controller rather than a neural-network black box.
- model mismatch and online feedback/receding-horizon correction.
- PID cascades and role of angle vs angular rate loops.
- Laplace transform and second-order ODEs as mathematical foundations.

Physical parameters identified as useful for wheel-legged LQR modeling included:

- body mass `m_b`
- body pitch inertia `I_by`
- COM height `h`
- wheel radius `r`
- wheel mass `m_w`
- wheel inertia `I_w`
- track width / geometry `d`
- actuator torque limit `tau_max`

## 9. Propulsion / motor test work

Motor/prop combinations investigated include:

- HOBBYWING X6 SE 6208-280KV + MFP 22x7.0 + 6S.
- T-hobby F60 Pro 2550KV.
- T-Motor 2207 V2.0 2550KV / related 2306/2400KV queries.

Typical analysis workflow:

- fit thrust vs RPM or PWM.
- fit torque coefficients.
- derive PWM as a function of rotational speed/thrust.
- inspect discontinuities/step changes in test data.
- correct RPM data if motor pole-pair setting was entered incorrectly, when raw electrical measurement relationship is known.

## 10. Networking / remote access / misc engineering environment

Systems used across projects:

- Ubuntu 22.04
- Windows 11
- macOS
- NoMachine remote desktop
- Orange Pi

Network debugging patterns:

- `ip -br link`
- `ip link show <iface>`
- `ethtool <iface>`

`NO-CARRIER` with the interface administratively UP generally points first to physical link/cable/peer/adapter negotiation rather than a ROS problem.

NOKOV + ROS/VRPN integration has also been explored for motion-capture communication with an Orange Pi.

## 11. Git / repository workflow

Frequently referenced repositories include:

- `AIMEtherCAT/EcatV2_Master`
- `AIMEtherCAT/hipnucimu`
- `ControlSystemLab-UNNC/Bipedal-Robot-RL-Controller`
- `ssybh2/foot_ws-ethercat`
- this repository: `ssybh2/Knowledge-Chatgpt`

Before pushing a workspace, historical checks included:

```bash
find . -mindepth 2 -type d -name .git -print
find . -type f -size +95M -not -path './.git/*' -printf '%s bytes  %p\n'
```

Purpose:

- detect nested repositories.
- detect files likely to violate GitHub size limits.

## 12. How a future AI agent should operate

When taking over this knowledge base:

1. Ask what current project/version the user is working on only if it cannot be inferred from the current conversation.
2. Read current repository source before asserting exact line numbers or parameters.
3. Use live terminal output as stronger evidence than this historical file.
4. For real robot debugging, first verify wiring, direction, units, limits, timing, and feedback freshness before tuning gains.
5. Separate simulation parameters from real-hardware parameters.
6. Treat all controller gains in this document as historical seeds, never as guaranteed safe real-hardware values.
7. When debugging EtherCAT, separate layers:
   - physical Ethernet link
   - slave discovery
   - EEPROM/identity
   - state transition INIT/PREOP/SAFEOP/OP
   - PDO mapping/WKC
   - application data
   - ROS2 wrapper
8. When debugging RL, inspect reward terms, observations, action scaling, termination conditions, curriculum, and policy logs before blaming the neural network.
9. Prefer reproducible commands and small controlled experiments.

## 13. Known historical conflicts / items requiring re-verification

- Wheel-center geometry changed across mechanical revisions.
- Five-bar dimensions exist in more than one historical model.
- IMU rate changed between ~333 Hz and desired 500 Hz.
- EtherCAT `app1/app2/app3` assignment may change with firmware.
- Some controller gains came from MuJoCo, some from physical tests.
- Pole-pair counts differ across motors and must never be copied between motor families.
- Local workspace names and user accounts changed between machines.

When in doubt, current source + current device output wins.
