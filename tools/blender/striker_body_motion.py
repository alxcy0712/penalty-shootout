"""Blender-authored coordinated striker motion; the previous clip remains available for comparison."""
from create_striker_prototype import (
    math, Vector, bound, smoother, hermite_keys, hermite_velocity,
    solve_joint, segment_matrix, ACTION_DURATION, SUPPORT_TOUCHDOWN, CONTACT_TIME,
)

def approach_foot(side, time):
    """World-space stance lock and C2 swing arcs, with overlapping support."""
    initial = 1.12 if side == 'L' else 1.36
    steps = [(.42,.74,.56),(1.00,1.22,.20)] if side == 'L' else [(.10,.40,.92),(.76,.98,.42)]
    y = initial
    for start, end, target in steps:
        if time <= start: break
        q = bound((time-start)/(end-start))
        if q < 1:
            return y+(target-y)*smoother(q), .065+.085*math.sin(math.pi*q)**3
        y = target
    return y, .065


def action_pose(time, ambient_time=None):
    ambient_time = time if ambient_time is None else ambient_time
    root_keys = [
        (0.00, 1.20), (.08,1.20), (.18,1.15), (.43,.99), (.62,.75),
        (.86,.56), (1.02,.44), (SUPPORT_TOUCHDOWN,.31),
        (CONTACT_TIME, 0.20), (1.72, 0.10), (2.08, -0.02), (2.46, -0.08),
        (ACTION_DURATION, -0.08),
    ]
    root_y = hermite_keys(root_keys, time)[0]
    speed = -hermite_velocity(root_keys, time, 1)
    run = smoother(time / 0.18) * (1.0 - smoother((time - 1.02) / 0.20))
    windup = smoother((time - 0.91) / 0.19) * (1.0 - smoother((time - 1.27) / 0.12))
    release = smoother((time - SUPPORT_TOUCHDOWN) / 0.30) * (1.0 - smoother((time - 1.78) / 0.34))
    settle = smoother((time - 1.68) / 0.78)
    plant_load = math.exp(-((time - 1.30) / 0.14) ** 2)
    push_off = math.exp(-((time - 1.50) / 0.16) ** 2)
    landing_load = sum(math.exp(-((time-t)/.08)**2) for t in [.40,.74,.98])
    hip_z = .904 - .016*landing_load - .055*plant_load + .008*push_off - .005*settle
    breath = math.sin(ambient_time * math.tau * 0.52) * 0.006 * (1.0 - run)
    idle_shift = hermite_keys([
        (0,0),(.10,-.035),(.40,-.035),(.48,.035),(.74,.035),
        (.80,-.035),(.98,-.035),(1.10,.02),(1.22,-.035),
        (1.50,-.065),(1.85,-.065),(2.15,-.025),(2.70,0),(3.20,0)
    ],time)[0]
    pelvis_yaw = -0.24 * windup + 0.28 * release
    chest_yaw = 0.16 * windup + 0.24 * smoother((time - 1.37) / .30) * (1 - smoother((time - 1.90) / .42))
    gait_twist = .08*bound((approach_foot('R',time)[0]-approach_foot('L',time)[0])/.48,-1,1)*run
    pelvis_yaw += gait_twist
    chest_yaw -= .65*gait_twist
    trunk_lean = 0.035 + min(0.11, max(0.0, speed) * 0.12) * run
    trunk_lean += 0.21 * release - 0.028 * windup - 0.04 * settle

    left_foot = hermite_keys([
        (SUPPORT_TOUCHDOWN,-.125,.20,.065),
        (2.34, -0.125, 0.20, 0.065), (2.44, -0.125, .10, .11),
        (2.57, -0.125, -.10, .13), (2.70, -0.125, -.20, .065),
        (ACTION_DURATION, -0.125, -.20, .065),
    ], time)
    right_foot = hermite_keys([
        (1.02,.125,.42,.065),(1.13,.125,.80,.29),
        (SUPPORT_TOUCHDOWN,.125,.85,.40),(1.36,.125,.64,.30),
        (1.46, 0.125, 0.47, 0.15), (1.52, 0.125, 0.40, 0.09),
        (CONTACT_TIME, 0.125, 0.25, 0.065), (1.63, 0.125, 0.02, 0.26),
        (1.75, 0.125, -0.12, 0.43), (1.88, 0.125, -0.16, 0.35),
        (2.02, 0.125, -.16, .16), (2.13, 0.125, -.16, .065),
        (ACTION_DURATION,.125,-.16,.065),
    ], time)
    if time <= SUPPORT_TOUCHDOWN:
        y,z=approach_foot('L',time)
        left_foot=(-.125,y,z)
    if time <= 1.02:
        y,z=approach_foot('R',time)
        right_foot=(.125,y,z)
    left_foot = (left_foot[0], left_foot[1], max(0.065, left_foot[2]))
    strike_align = smoother((time - 1.03) / (CONTACT_TIME - 1.03)) * (1.0 - smoother((time - 1.75) / 0.38))
    right_foot = (right_foot[0] * (1.0 - strike_align), right_foot[1], max(0.065, right_foot[2]))
    for sign, foot in [(-1,left_foot),(1,right_foot)]:
        dx = idle_shift + sign*.125*math.cos(pelvis_yaw) - foot[0]
        dy = root_y + sign*.125*math.sin(pelvis_yaw) - foot[1]
        ceiling = foot[2] + math.sqrt(max(.1, .85**2-dx*dx-dy*dy))
        blend = max(.02-abs(hip_z-ceiling),0)/.02
        hip_z = min(hip_z,ceiling)-blend*blend*.02/4
    center = (idle_shift, root_y, hip_z)
    positions = {"root": (0.0, root_y, 0.0)}
    for side, sign, foot in (("L", -1, left_foot), ("R", 1, right_foot)):
        hip = (idle_shift + sign * .125 * math.cos(pelvis_yaw), root_y + sign * .125 * math.sin(pelvis_yaw), hip_z)
        ankle = tuple(foot)
        knee = solve_joint(hip, ankle, 0.43, 0.43, (0.0, -0.65, 0.35))
        positions[f"thigh.{side}"] = segment_matrix(hip, knee)
        positions[f"shin.{side}"] = segment_matrix(knee, ankle)
        pitch = .45 * smoother((ankle[2]-.065)/.11)
        if side == 'R':
            pitch += .30*windup - .60*smoother((time-1.55)/.20)*(1-smoother((time-1.88)/.25))
        pitch = bound(pitch, -.25, math.asin(bound((ankle[2]-.065)/.24)))
        toe = (ankle[0], ankle[1] - .16*math.cos(pitch), ankle[2] - .01 - .16*math.sin(pitch))
        positions[f"foot.{side}"] = segment_matrix(ankle, toe)
        toe_end = (toe[0], toe[1] - .09*math.cos(pitch), toe[2] - .005 - .09*math.sin(pitch))
        positions[f"toe.{side}"] = segment_matrix(toe, toe_end)

    pelvis_top = (idle_shift, root_y - trunk_lean * 0.17, hip_z + 0.19)
    spine_top = (idle_shift, root_y - trunk_lean * 0.55, hip_z + 0.43 + breath)
    chest_top = (idle_shift, root_y - trunk_lean * 0.70, hip_z + 0.51 + breath)
    neck_top = (idle_shift, root_y - trunk_lean * 0.80, hip_z + 0.63 + breath)
    head_top = (idle_shift, root_y - trunk_lean * 0.84, hip_z + 0.85 + breath)
    positions["pelvis"] = segment_matrix(center, pelvis_top, pelvis_yaw)
    positions["spine"] = segment_matrix(pelvis_top, spine_top, chest_yaw * 0.72)
    positions["chest"] = segment_matrix(spine_top, chest_top, chest_yaw)
    positions["neck"] = segment_matrix(chest_top, neck_top, chest_yaw * 0.25)
    positions["head"] = segment_matrix(neck_top, head_top, chest_yaw * 0.15)

    for side, sign in (("L", -1), ("R", 1)):
        shoulder_center = Vector((idle_shift,root_y-trunk_lean*.67,hip_z+.49+breath))
        shoulder = tuple(shoulder_center + Vector((sign*.195*math.cos(chest_yaw),sign*.195*math.sin(chest_yaw),0)))
        positions[f"clavicle.{side}"] = segment_matrix(shoulder_center, shoulder)
        # Contralateral upper-arm swing with a delayed forearm response.
        def swing(t):
            left_y,_=approach_foot('L',t)
            right_y,_=approach_foot('R',t)
            return bound((right_y-left_y)/.48,-1,1)*(-sign)
        stride = swing(time)*run
        delayed = swing(max(0,time-.065))*run
        balance = (.45*windup-.50*release) if side=='L' else (-.28*windup+.32*release)
        upper_angle = .10 + .62*stride + balance
        flex = .28 + .85*run + .40*windup + .28*release + .15*(delayed-stride)
        spread = .13 + .16*windup + .10*release
        upper_direction = Vector((sign*spread, math.sin(upper_angle), -math.cos(upper_angle))).normalized()
        elbow = Vector(shoulder) + upper_direction*.29
        forearm_angle = upper_angle-flex
        forearm_direction = Vector((sign*.06,math.sin(forearm_angle),-math.cos(forearm_angle))).normalized()
        wrist = elbow+forearm_direction*.27
        positions[f"upper_arm.{side}"] = segment_matrix(shoulder, elbow)
        positions[f"forearm.{side}"] = segment_matrix(elbow, wrist)
        # The palm follows the forearm; its small delayed flex removes the fixed
        # world-facing hand orientation without adding finger animation tracks.
        hand_angle = forearm_angle+.10*(delayed-stride)
        hand_direction = Vector((sign*.06,math.sin(hand_angle),-math.cos(hand_angle))).normalized()
        positions[f"hand.{side}"] = segment_matrix(wrist, wrist+hand_direction*.08)
    return positions
